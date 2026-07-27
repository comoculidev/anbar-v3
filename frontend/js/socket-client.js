// Frontend indi backend-in özündən paylandığı üçün ünvan boş buraxılır (eyni origin).
// Əgər frontend-i ayrıca portda saxlamaq istəsəniz, buraya tam backend ünvanını yazın.
const SOCKET_URL = '';

function connectSocket() {
  const socket = io(SOCKET_URL || undefined, { withCredentials: true });
  return socket;
}
