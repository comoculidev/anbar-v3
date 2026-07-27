// Sidebar-da gözləyən istək/wishlist saylarını real-time göstərən ortaq skript.
// options.requestStatus - hansı status sayılacaq (admin üçün 'pending', superadmin üçün 'pending_superadmin')
// options.includeWishlist - wishlist sayğacı göstərilsinmi (superadmin səhifələrində lazım deyil)
async function initNotifBadges(options = {}) {
  const { requestStatus = 'pending', includeWishlist = true } = options;
  const reqBadge = document.getElementById('reqBadge');
  const wishBadge = document.getElementById('wishBadge');
  if (!reqBadge && !wishBadge) return;

  function updateBadge(el, count) {
    if (!el) return;
    if (count > 0) {
      el.textContent = count;
      el.style.display = 'inline-block';
    } else {
      el.style.display = 'none';
    }
  }

  async function refreshCounts() {
    try {
      const tasks = [api.get(`/requests?status=${requestStatus}`)];
      if (includeWishlist) tasks.push(api.get('/wishlist?status=pending'));
      const results = await Promise.all(tasks);
      updateBadge(reqBadge, results[0].requests.length);
      if (includeWishlist) updateBadge(wishBadge, results[1].wishlist.length);
    } catch (_) { /* səssiz uğursuzluq - sidebar bildirişi kritik deyil */ }
  }

  refreshCounts();

  const socket = connectSocket();
  socket.on('request:new', refreshCounts);
  socket.on('request:updated', refreshCounts);
  if (includeWishlist) {
    socket.on('wishlist:new', refreshCounts);
    socket.on('wishlist:updated', refreshCounts);
  }
}
