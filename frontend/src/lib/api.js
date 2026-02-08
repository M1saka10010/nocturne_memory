import axios from 'axios';

const api = axios.create({
  baseURL: '/api'
});

// Handle URI encoding for resource IDs which might contain special chars
const encodeId = (id) => encodeURIComponent(id);

// ============ Review API (Session & Snapshot) ============

export const getSessions = () => api.get('/review/sessions').then(res => res.data);

export const getSnapshots = (sessionId) => 
  api.get(`/review/sessions/${sessionId}/snapshots`).then(res => res.data);

export const getDiff = (sessionId, resourceId) => 
  api.get(`/review/sessions/${sessionId}/diff/${encodeId(resourceId)}`).then(res => res.data);

export const rollbackResource = (sessionId, resourceId) => 
  api.post(`/review/sessions/${sessionId}/rollback/${encodeId(resourceId)}`, {}).then(res => res.data);

export const approveSnapshot = (sessionId, resourceId) => 
  api.delete(`/review/sessions/${sessionId}/snapshots/${encodeId(resourceId)}`).then(res => res.data);

export const clearSession = (sessionId) => 
  api.delete(`/review/sessions/${sessionId}`).then(res => res.data);

// ============ Catalog API (SQLite/URI Model) ============

// getCatalog has been removed in favor of browse/roots and browse/node
// See backend/api/browse.py

