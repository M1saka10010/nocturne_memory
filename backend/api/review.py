"""
Review API - Selective Rollback for Database Changes

This module provides endpoints for Salem to review and selectively rollback
Nocturne's database modifications.

Design Philosophy:
- Rollback doesn't delete versions; it creates a NEW version with old content
- This preserves the complete history while allowing content restoration
- Session-based organization makes it easy to review changes from specific runs
"""

from fastapi import APIRouter, HTTPException
from typing import List
import difflib

from models import (
    DiffRequest, DiffResponse,
    SessionInfo, SnapshotInfo, SnapshotDetail, ResourceDiff,
    RollbackRequest, RollbackResponse
)
from .utils import get_text_diff
from db.snapshot import get_snapshot_manager
from db.neo4j_client import get_neo4j_client

router = APIRouter(prefix="/review", tags=["review"])


# ========== Session & Snapshot Endpoints ==========

@router.get("/sessions", response_model=List[SessionInfo])
async def list_sessions():
    """
    列出所有有快照的 session
    
    每个 MCP 服务器实例运行期间算作一个 session。
    Session ID 格式: mcp_YYYYMMDD_HHMMSS_{random}
    """
    manager = get_snapshot_manager()
    sessions = manager.list_sessions()
    return [SessionInfo(**s) for s in sessions]


@router.get("/sessions/{session_id}/snapshots", response_model=List[SnapshotInfo])
async def list_session_snapshots(session_id: str):
    """
    列出指定 session 中的所有快照
    
    返回每个被修改过的资源的快照元信息。
    """
    manager = get_snapshot_manager()
    snapshots = manager.list_snapshots(session_id)
    
    if not snapshots:
        raise HTTPException(
            status_code=404,
            detail=f"Session '{session_id}' not found or has no snapshots"
        )
    
    return [SnapshotInfo(**s) for s in snapshots]


@router.get("/sessions/{session_id}/snapshots/{resource_id:path}", response_model=SnapshotDetail)
async def get_snapshot_detail(session_id: str, resource_id: str):
    """
    获取指定快照的详细数据
    
    resource_id 示例:
    - Entity: "char_nocturne"
    - Direct Edge: "rel:char_nocturne>char_salem"
    - Chapter: "chap:char_nocturne>char_salem:first_meeting"
    """
    manager = get_snapshot_manager()
    snapshot = manager.get_snapshot(session_id, resource_id)
    
    if not snapshot:
        raise HTTPException(
            status_code=404,
            detail=f"Snapshot for '{resource_id}' not found in session '{session_id}'"
        )
    
    return SnapshotDetail(
        resource_id=snapshot["resource_id"],
        resource_type=snapshot["resource_type"],
        snapshot_time=snapshot["snapshot_time"],
        data=snapshot["data"]
    )


# ========== Diff Endpoints ==========

def _get_current_content(resource_type: str, data: dict) -> str:
    """
    获取资源的当前内容（用于 diff 对比）
    """
    client = get_neo4j_client()
    
    if resource_type == "entity":
        entity_id = data["entity_id"]
        info = client.get_entity_info(entity_id, include_basic=True)
        state = info.get("basic") if info else None
        if not state:
            return "[DELETED]"
        return state.get("content", "")
    
    elif resource_type == "direct_edge":
        viewer_id = data["viewer_id"]
        target_id = data["target_id"]
        rel_data = client.get_relationship_structure(viewer_id, target_id)
        direct = rel_data.get("direct")
        if not direct:
            return "[DELETED]"
        return direct.get("content", "")
    
    elif resource_type == "relay_edge":
        relay_entity_id = data["relay_entity_id"]
        info = client.get_entity_info(relay_entity_id, include_basic=True)
        state = info.get("basic") if info else None
        if not state:
            return "[DELETED]"
        return state.get("content", "")
    
    elif resource_type == "parent_link":
        entity_id = data["entity_id"]
        parent_id = data["parent_id"]
        # 这里不能通过 get_entity_info(include_children=True) 的子节点列表判断，
        # 因为 get_entity_info 在查询子节点时有 LIMIT 50。
        # 如果父节点子节点超过 50 个且当前子节点排在 50 之后，会被误判为未关联。
        link_exists = client.has_parent_link(entity_id, parent_id)
        
        if link_exists:
            return f"LINK EXISTS: {entity_id} -> {parent_id}"
        else:
            return "[NOT LINKED]"
    
    return "[UNKNOWN TYPE]"


def _compute_diff(old_content: str, new_content: str) -> tuple:
    """
    计算两个文本的 diff
    返回 (unified_diff, summary)
    """
    old_lines = old_content.splitlines(keepends=True)
    new_lines = new_content.splitlines(keepends=True)
    
    diff = difflib.unified_diff(old_lines, new_lines, fromfile='snapshot', tofile='current')
    unified = ''.join(diff)
    
    # 简单统计
    additions = sum(1 for line in unified.splitlines() if line.startswith('+') and not line.startswith('+++'))
    deletions = sum(1 for line in unified.splitlines() if line.startswith('-') and not line.startswith('---'))
    
    if additions == 0 and deletions == 0:
        summary = "No changes"
    else:
        summary = f"+{additions} / -{deletions} lines"
    
    return unified, summary


@router.get("/sessions/{session_id}/diff/{resource_id:path}", response_model=ResourceDiff)
async def get_resource_diff(session_id: str, resource_id: str):
    """
    获取快照与当前状态的 diff
    
    这是回滚前查看变化的主要端点。
    
    对于 modify 类型：显示内容变化
    对于 create 类型：显示新创建的内容（快照为空）
    """
    manager = get_snapshot_manager()
    snapshot = manager.get_snapshot(session_id, resource_id)
    
    if not snapshot:
        raise HTTPException(
            status_code=404,
            detail=f"Snapshot for '{resource_id}' not found in session '{session_id}'"
        )
    
    operation_type = snapshot["data"].get("operation_type", "modify")
    
    # Special handling for structural changes (parent_link)
    if snapshot["resource_type"] == "parent_link":
        entity_id = snapshot["data"]["entity_id"]
        parent_id = snapshot["data"]["parent_id"]
        current_content = _get_current_content("parent_link", snapshot["data"])
        
        if operation_type == "create":
            snapshot_content = "[NO LINK]"
            if "LINK EXISTS" in current_content:
                summary = "Created Parent Link (Rollback = Unlink)"
                has_changes = True
                unified = f"--- /dev/null\n+++ {resource_id}\n+Parent Link: {entity_id} -> {parent_id}"
            else:
                summary = "Link already removed"
                has_changes = False
                unified = "No changes"
                
        elif operation_type == "delete":
            snapshot_content = f"Parent Link: {entity_id} -> {parent_id}"
            if "NOT LINKED" in current_content:
                summary = "Deleted Parent Link (Rollback = Restore Link)"
                has_changes = True
                unified = f"--- {resource_id}\n+++ /dev/null\n-Parent Link: {entity_id} -> {parent_id}"
            else:
                summary = "Link already restored"
                has_changes = False
                unified = "No changes"
        else:
             snapshot_content = ""
             summary = "Unknown operation"
             has_changes = False
             unified = ""
             
        return ResourceDiff(
            resource_id=resource_id,
            resource_type=snapshot["resource_type"],
            snapshot_time=snapshot["snapshot_time"],
            snapshot_content=snapshot_content,
            current_content=current_content,
            diff_unified=unified,
            diff_summary=summary,
            has_changes=has_changes
        )
    
    if operation_type == "create":
        # For create operations, snapshot has no content
        snapshot_content = "[NOT EXISTS - newly created]"
        current_content = _get_current_content(snapshot["resource_type"], snapshot["data"])
        
        if current_content == "[DELETED]":
            summary = "Created then deleted"
            has_changes = False
        else:
            # Show the created content
            line_count = len(current_content.splitlines())
            summary = f"Created: +{line_count} lines (rollback = delete)"
            has_changes = True
        
        unified = f"--- /dev/null\n+++ {resource_id}\n"
        if current_content and current_content != "[DELETED]":
            for line in current_content.splitlines():
                unified += f"+{line}\n"
    else:
        # For modify operations, show the diff
        snapshot_content = snapshot["data"].get("content", "")
        current_content = _get_current_content(snapshot["resource_type"], snapshot["data"])
        
        unified, summary = _compute_diff(snapshot_content, current_content)
        has_changes = snapshot_content != current_content
    
    return ResourceDiff(
        resource_id=resource_id,
        resource_type=snapshot["resource_type"],
        snapshot_time=snapshot["snapshot_time"],
        snapshot_content=snapshot_content,
        current_content=current_content,
        diff_unified=unified,
        diff_summary=summary,
        has_changes=has_changes
    )


# ========== Rollback Endpoints ==========

def _rollback_entity(data: dict, task_description: str) -> dict:
    """执行 Entity 回滚"""
    client = get_neo4j_client()
    entity_id = data["entity_id"]
    operation_type = data.get("operation_type", "modify")
    
    if operation_type == "create":
        # Rollback of create = delete the entity
        info = client.get_entity_info(entity_id, include_basic=True)
        current = info.get("basic") if info else None
        if not current:
            # Already deleted, nothing to do
            return {"new_version": None, "deleted": True}
        
        # Try to delete all states first, then the entity
        # This may fail if there are edges referencing this entity
        try:
            # Get all states for this entity and delete them
            version = current["version"]
            for v in range(version, 0, -1):
                state_id = f"{entity_id}_v{v}"
                try:
                    client.delete_state(state_id)
                except ValueError:
                    pass  # State might have dependencies or not exist
            
            # Now try to delete the entity itself
            client.delete_entity(entity_id)
            return {"new_version": None, "deleted": True}
        except ValueError as e:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot delete entity '{entity_id}': {str(e)}. "
                       f"Delete dependent edges first."
            )
    else:
        # Rollback of modify = restore content
        snapshot_content = data.get("content", "")
        
        info = client.get_entity_info(entity_id, include_basic=True)
        current = info.get("basic") if info else None
        if not current:
            raise HTTPException(
                status_code=404,
                detail=f"Entity '{entity_id}' no longer exists, cannot rollback"
            )
        
        current_content = current.get("content", "")
        
        # Check if there's actually anything to rollback
        if snapshot_content == current_content:
            # No-op: content is identical, no rollback needed
            return {"new_version": current.get("version"), "no_change": True}
        
        result = client.update_entity(
            entity_id=entity_id,
            new_content=snapshot_content,
            task_description=task_description
        )
        
        return {"new_version": result["new_version"]}


def _rollback_direct_edge(data: dict, task_description: str) -> dict:
    """执行 Direct Edge 回滚"""
    client = get_neo4j_client()
    viewer_id = data["viewer_id"]
    target_id = data["target_id"]
    operation_type = data.get("operation_type", "modify")
    
    if operation_type == "create":
        # Rollback of create = delete the direct edge
        rel_data = client.get_relationship_structure(viewer_id, target_id)
        if not rel_data.get("direct"):
            # Already deleted
            return {"new_version": None, "deleted": True}
        
        # Check if there are chapters under this relationship
        relays = rel_data.get("relays", [])
        relays = [r for r in relays if r is not None]
        
        if relays:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot delete relationship '{viewer_id}>{target_id}': "
                       f"it has {len(relays)} chapter(s). Delete chapters first."
            )
        
        # Delete the direct edge
        try:
            client.delete_direct_edge(viewer_id, target_id, force=False)
            return {"new_version": None, "deleted": True}
        except ValueError as e:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot delete relationship: {str(e)}"
            )
    else:
        # Rollback of modify = restore content
        snapshot_content = data.get("content", "")
        snapshot_relation = data.get("relation", "RELATIONSHIP")
        snapshot_inheritable = data.get("inheritable", True)
        
        rel_data = client.get_relationship_structure(viewer_id, target_id)
        direct = rel_data.get("direct")
        if not direct:
            raise HTTPException(
                status_code=404,
                detail=f"Relationship '{viewer_id}>{target_id}' no longer exists, cannot rollback"
            )
        
        current_content = direct.get("content", "")
        current_relation = direct.get("relation", "RELATIONSHIP")
        current_inheritable = direct.get("inheritable", True)
        
        # Check if there's actually anything to rollback
        if (snapshot_content == current_content and 
            snapshot_relation == current_relation and 
            snapshot_inheritable == current_inheritable):
            # No-op: content is identical, no rollback needed
            # We don't have direct access to viewer version here easily, so return None
            return {"new_version": None, "no_change": True}
        
        result = client.evolve_relationship(
            viewer_entity_id=viewer_id,
            target_entity_id=target_id,
            direct_patch={
                "content": snapshot_content,
                "relation": snapshot_relation,
                "inheritable": snapshot_inheritable
            },
            task_description=task_description
        )
        
        return {"new_version": result["viewer_new_version"]}


def _rollback_relay_edge(data: dict, task_description: str) -> dict:
    """执行 Relay Edge (Chapter) 回滚"""
    client = get_neo4j_client()
    relay_entity_id = data["relay_entity_id"]
    operation_type = data.get("operation_type", "modify")
    
    if operation_type == "create":
        # Rollback of create = delete the chapter
        info = client.get_entity_info(relay_entity_id, include_basic=True)
        current = info.get("basic") if info else None
        if not current:
            # Already deleted
            print(f"[Rollback Debug] Relay entity {relay_entity_id} already gone. Skipping.")
            return {"new_version": None, "deleted": True}
        
        viewer_id = data["viewer_id"]
        target_id = data["target_id"]
        chapter_name = data["chapter_name"]
        
        # Generate edge_id for the relay edge
        edge_id = client._generate_edge_id(viewer_id, chapter_name, target_id)
        print(f"[Rollback Debug] Attempting to rollback chapter '{chapter_name}'")
        print(f"[Rollback Debug] Calculated edge_id: {edge_id}")
        print(f"[Rollback Debug] Relay entity ID: {relay_entity_id}")

        # DEBUG: Check if edge exists before deleting
        with client.driver.session() as session:
            # 1. 精确查找
            check = session.run("MATCH ()-[r:RELAY_EDGE {edge_id: $eid}]->() RETURN count(r) as c", eid=edge_id).single()
            count = check["c"] if check else 0
            print(f"[Rollback Debug] Neo4j reports {count} RELAY_EDGEs with EXACT edge_id: '{edge_id}'")
            print(f"[Rollback Debug] edge_id hex: {edge_id.encode('utf-8').hex()}")
            
            # 2. 模糊查找/全量打印（仅当精确查找失败时）
            if count == 0:
                print("[Rollback Debug] Exact match failed. Dumping ALL RELAY_EDGE IDs in DB:")
                all_edges = session.run("MATCH ()-[r:RELAY_EDGE]->() RETURN DISTINCT r.edge_id as eid LIMIT 50")
                for rec in all_edges:
                    db_id = rec["eid"]
                    print(f"  - DB ID: '{db_id}'")
                    print(f"    Hex:   {str(db_id).encode('utf-8').hex()}")
                    if db_id == edge_id:
                        print("    (WTF: Python says they are equal, but Cypher match failed?)")
        
        try:
            # First delete the relay edge connections
            print("[Rollback Debug] Calling delete_relay_edge...")
            try:
                client.delete_relay_edge(edge_id)
                print("[Rollback Debug] delete_relay_edge success.")
            except ValueError as ve:
                # 如果Relay Edge已经不存在，就当作“已删除”，继续后续清理
                msg = str(ve)
                if "Relay edge with id" in msg and "not found" in msg:
                    print(
                        "[Rollback Debug] delete_relay_edge reported 'not found', "
                        "treating as already deleted and continuing."
                    )
                else:
                    raise
            
            # Then delete all states of the relay entity
            # 不再依赖 version 推测 state_id，而是直接查询 DB 中所有属于该 entity 的 State
            with client.driver.session() as session:
                state_rows = session.run(
                    """
                    MATCH (s:State)
                    WHERE s.entity_id = $relay_entity_id
                    RETURN s.id as id, s.version as version
                    ORDER BY s.version DESC
                    """,
                    relay_entity_id=relay_entity_id,
                )
                state_ids = [row["id"] for row in state_rows]

            print(
                f"[Rollback Debug] Deleting {len(state_ids)} states for relay entity "
                f"{relay_entity_id}: {state_ids}"
            )

            for state_id in state_ids:
                # 这里不再吃掉异常，方便定位具体依赖
                try:
                    client.delete_state(state_id)
                    print(f"[Rollback Debug] Deleted state {state_id}")
                except ValueError as ve:
                    print(f"[Rollback Debug] Failed to delete state {state_id}: {ve}")
                    raise
            
            # Finally delete the relay entity
            print("[Rollback Debug] Deleting relay entity...")
            client.delete_entity(relay_entity_id)
            print("[Rollback Debug] Rollback complete.")
            
            return {"new_version": None, "deleted": True}
        except ValueError as e:
            # 直接把底层错误冒泡给调用方，便于 debug
            error_msg = f"Cannot delete chapter '{chapter_name}' (relay_entity_id={relay_entity_id}): {str(e)}"
            print(f"[Rollback Debug] ERROR CAUGHT: {error_msg}")
            raise HTTPException(
                status_code=409,
                detail=error_msg
            )
    else:
        # Rollback of modify = restore content
        # CRITICAL: We must use evolve_relationship instead of update_entity
        # to ensure RELAY_EDGE connections are properly maintained.
        # update_entity only updates the State content, but doesn't rebuild
        # the RELAY_EDGE which may have been moved or modified.
        snapshot_content = data.get("content", "")
        snapshot_inheritable = data.get("inheritable", True)
        
        viewer_id = data["viewer_id"]
        target_id = data["target_id"]
        chapter_name = data["chapter_name"]
        
        info = client.get_entity_info(relay_entity_id, include_basic=True)
        current = info.get("basic") if info else None
        if not current:
            raise HTTPException(
                status_code=404,
                detail=f"Chapter '{relay_entity_id}' no longer exists, cannot rollback"
            )
        
        current_content = current.get("content", "")
        current_inheritable = current.get("inheritable", True)
        
        # Check if there's actually anything to rollback
        if snapshot_content == current_content and snapshot_inheritable == current_inheritable:
            # No-op: content is identical, no rollback needed
            # Return current version to indicate success without creating unnecessary versions
            return {"new_version": current.get("version"), "no_change": True}
        
        # Use evolve_relationship to properly update chapter AND maintain edges
        client.evolve_relationship(
            viewer_entity_id=viewer_id,
            target_entity_id=target_id,
            chapter_updates={
                chapter_name: {
                    "content": snapshot_content,
                    "inheritable": snapshot_inheritable
                }
            },
            task_description=task_description
        )
        
        # Query the chapter's new version (evolve_relationship returns viewer version, not chapter version)
        updated_info = client.get_entity_info(relay_entity_id, include_basic=True)
        chapter_new_version = updated_info["basic"]["version"] if updated_info and updated_info.get("basic") else None
        
        return {"new_version": chapter_new_version}


def _rollback_parent_link(data: dict, task_description: str) -> dict:
    """执行 Parent Link 回滚"""
    client = get_neo4j_client()
    entity_id = data["entity_id"]
    parent_id = data["parent_id"]
    operation_type = data.get("operation_type", "create")
    
    if operation_type == "create":
        # Rollback of create = unlink
        try:
            # Check if link exists first? unlink_parent usually handles non-existence gracefully 
            # or raises error if not found. Let's try unlink.
            client.unlink_parent(entity_id, parent_id)
            return {"new_version": None, "deleted": True}
        except ValueError:
            # If not found, it's already "unlinked", so rollback is effectively done.
            return {"new_version": None, "deleted": True}
            
    elif operation_type == "delete":
        # Rollback of delete = re-link
        try:
            client.link_parent(entity_id, parent_id)
            # link_parent doesn't return version, so we return None
            return {"new_version": None} 
        except ValueError as e:
             raise HTTPException(
                status_code=409, 
                detail=f"Cannot restore parent link: {str(e)}"
             )
    
    return {"new_version": None}


@router.post("/sessions/{session_id}/rollback/{resource_id:path}", response_model=RollbackResponse)
async def rollback_resource(session_id: str, resource_id: str, request: RollbackRequest):
    """
    执行回滚：将资源恢复到快照状态
    
    两种回滚模式：
    1. **modify 回滚**：创建新版本，内容等于快照（版本历史保留）
    2. **create 回滚**：删除新创建的资源（如果有依赖会失败）
    
    这是 Salem 控制 Nocturne 修改的主要手段。
    """
    manager = get_snapshot_manager()
    snapshot = manager.get_snapshot(session_id, resource_id)
    
    if not snapshot:
        raise HTTPException(
            status_code=404,
            detail=f"Snapshot for '{resource_id}' not found in session '{session_id}'"
        )
    
    resource_type = snapshot["resource_type"]
    data = snapshot["data"]
    operation_type = data.get("operation_type", "modify")
    task_desc = request.task_description or "Rollback to snapshot by Salem"
    
    try:
        if resource_type == "entity":
            result = _rollback_entity(data, task_desc)
        elif resource_type == "direct_edge":
            result = _rollback_direct_edge(data, task_desc)
        elif resource_type == "relay_edge":
            result = _rollback_relay_edge(data, task_desc)
        elif resource_type == "parent_link":
            result = _rollback_parent_link(data, task_desc)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown resource type: {resource_type}"
            )
        
        # Different message based on operation type
        if operation_type == "create":
            if result.get("deleted"):
                message = f"Successfully deleted created resource '{resource_id}'."
            else:
                message = "Resource was already deleted."
        elif operation_type == "delete":
             message = f"Successfully restored resource '{resource_id}'."
        else:
            if result.get("no_change"):
                message = f"No changes detected. Content already matches snapshot (v{result.get('new_version')})."
            else:
                message = f"Successfully restored content. Created version {result.get('new_version')}."
        
        return RollbackResponse(
            resource_id=resource_id,
            resource_type=resource_type,
            success=True,
            message=message,
            new_version=result.get("new_version")
        )
        
    except HTTPException:
        raise
    except Exception as e:
        return RollbackResponse(
            resource_id=resource_id,
            resource_type=resource_type,
            success=False,
            message=f"Rollback failed: {str(e)}",
            new_version=None
        )


@router.delete("/sessions/{session_id}/snapshots/{resource_id:path}")
async def delete_snapshot(session_id: str, resource_id: str):
    """
    删除指定的快照（确认不需要回滚后）
    """
    manager = get_snapshot_manager()
    deleted = manager.delete_snapshot(session_id, resource_id)
    
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=f"Snapshot for '{resource_id}' not found in session '{session_id}'"
        )
    
    return {"message": f"Snapshot for '{resource_id}' deleted"}


@router.delete("/sessions/{session_id}")
async def clear_session(session_id: str):
    """
    清除整个 session 的所有快照
    
    当 Salem 确认所有修改都 OK 后调用此端点清理。
    """
    manager = get_snapshot_manager()
    count = manager.clear_session(session_id)
    
    if count == 0:
        raise HTTPException(
            status_code=404,
            detail=f"Session '{session_id}' not found or already empty"
        )
    
    return {"message": f"Session '{session_id}' cleared, {count} snapshots deleted"}


# ========== Utility Endpoints ==========

@router.post("/diff", response_model=DiffResponse)
async def compare_text(request: DiffRequest):
    """
    比较两个文本并返回diff

    Args:
        request: 包含text_a和text_b

    Returns:
        DiffResponse: 包含diff_html, diff_unified, summary
    """
    try:
        diff_html, diff_unified, summary = get_text_diff(
            request.text_a,
            request.text_b
        )
        return DiffResponse(
            diff_html=diff_html,
            diff_unified=diff_unified,
            summary=summary
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ========== 占位符端口 ==========

@router.get("/nodes/entities/{entity_id}/diff")
async def get_version_diff(entity_id: str, from_version: int, to_version: int):
    """
    【占位符】对比节点的两个版本

    TODO: 实现此端口
    用于懒更新时判断变化是否影响引用者
    """
    raise HTTPException(status_code=501, detail="Not implemented yet")
