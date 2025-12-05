import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  deleteDoc,
  doc,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAyyW44KAhKbl-pz5yXSlZveDJNAVETqpY",
  authDomain: "cafe-afe4b.firebaseapp.com",
  projectId: "cafe-afe4b",
  storageBucket: "cafe-afe4b.firebasestorage.app",
  messagingSenderId: "115862613556",
  appId: "1:115862613556:web:23e5fa5648137ff79d2461",
  measurementId: "G-3056BTEZPX",
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const ordersCol = collection(db, "orders");
const qs = (k) => new URL(location.href).searchParams.get(k);
const nowISO = () => new Date().toISOString();
function showToast(msg, ms = 3000) {
  const el = document.createElement("div");
  el.textContent = msg;
  Object.assign(el.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    padding: "8px 12px",
    background: "#222",
    color: "#fff",
    borderRadius: "8px",
    zIndex: 9999,
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

let allData = [];
let allDataMap = new Map();
const priceFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

// --- Lazy-loading helper (native + IntersectionObserver fallback) ---
const _transparentPixel =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const supportsNativeLazy = "loading" in HTMLImageElement.prototype;

let lazyObserver = null;
function ensureLazyObserver() {
  if (lazyObserver || typeof IntersectionObserver === "undefined") return;
  lazyObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        lazyObserver.unobserve(img);
        const src = img.dataset.src;
        if (src) {
          img.src = src;
          img.removeAttribute("data-src");
        }
      });
    },
    { rootMargin: "200px 0px" }
  );
}

function prepareLazyImage(img, src, opts = {}) {
  if (!img) return;
  if (opts.alt) img.alt = opts.alt;
  img.onerror = () => {
    img.src = opts.errorSrc || "owl-logo.webp";
  };

  if (supportsNativeLazy) {
    img.loading = "lazy";
    img.src = src || opts.errorSrc || "owl-logo.webp";
  } else if (typeof IntersectionObserver !== "undefined") {
    img.dataset.src = src || opts.errorSrc || "owl-logo.webp";
    img.src = _transparentPixel;
    ensureLazyObserver();
    lazyObserver.observe(img);
  } else {
    img.src = src || opts.errorSrc || "owl-logo.webp";
  }
}

async function fetchAndInit() {
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    allData = await res.json();
  } catch (err) {
    console.error("Failed to load data.json", err);
    allData = [];
  }
  allData = allData.map((p) => ({
    id: String(p.id),
    name: p.name || "Unnamed",
    price: Number(p.price || 0),
    image: p.image || "owl-logo.webp",
    category: p.category || "Uncategorized",
    description: p.description || "",
    prep: p.prep || p.preparation || "",
    popular: !!p.popular,
    tags: Array.isArray(p.tags) ? p.tags : [],
  }));
  allDataMap = new Map(allData.map((d) => [d.id, d]));

  if (document.body.dataset.page === "customer") initCustomerPage();
  if (document.body.dataset.page === "kds") initKDSPage();
}

function parsePrepMinutes(prepStr) {
  if (!prepStr) return 0;
  const m = String(prepStr).match(/(\d+)\s*(min|mins|minutes)?/i);
  if (m) return Number(m[1]);
  const m2 = String(prepStr).match(/(\d+)/);
  return m2 ? Number(m2[1]) : 0;
}
const DEFAULT_KITCHEN_CONCURRENCY = 3;
const DEFAULT_BUFFER_MIN = 2;
function computeCartETA(
  cart,
  concurrency = DEFAULT_KITCHEN_CONCURRENCY,
  bufferMin = DEFAULT_BUFFER_MIN
) {
  if (!Array.isArray(cart) || cart.length === 0)
    return { totalMins: 0, label: "—" };
  const perItem = cart.map((it) => {
    const item = allData.find((d) => d.id === it.id);
    const mins = item ? parsePrepMinutes(item.prep) : 0;
    return { id: it.id, qty: it.qty, prep: Math.max(0, Number(mins) || 0) };
  });
  const totalWork = perItem.reduce((s, x) => s + x.prep * x.qty, 0);
  const maxPrep = perItem.reduce((m, x) => Math.max(m, x.prep), 0);
  const K = Math.max(1, Math.floor(concurrency));
  if (totalWork <= 0) return { totalMins: 0, label: "—" };
  let extra = 0;
  if (totalWork > maxPrep) extra = Math.ceil((totalWork - maxPrep) / K);
  const etaMinutes = maxPrep + extra + Math.max(0, Math.floor(bufferMin));
  const target = new Date(Date.now() + etaMinutes * 60000);
  return {
    totalMins: etaMinutes,
    label: `${etaMinutes} min (approx ${target.toLocaleTimeString()})`,
  };
}

const itemsCol = collection(db, "items");
let hiddenMap = new Map(); // id -> boolean

onSnapshot(
  query(itemsCol, orderBy("name")),
  (snap) => {
    hiddenMap.clear();
    for (const d of snap.docs) {
      const id = String(d.id);
      const data = d.data() || {};
      hiddenMap.set(id, !!data.hidden);
    }
    window.dispatchEvent(new Event("items-hidden-updated"));
  },
  (err) => {
    console.error("items snapshot error", err);
  }
);

function initCustomerPage() {
  const popularContainer = document.getElementById("popular-container");
  const categoryContainer = document.getElementById("category-container");
  const allContainer = document.getElementById("all-container");
  const searchInput = document.getElementById("search-input");
  const openCartBtn = document.getElementById("open-cart");
  const drawer = document.getElementById("drawer");
  const drawerOverlay = document.getElementById("drawer-overlay");
  const closeDrawerBtn = document.getElementById("close-drawer");
  const cartList = document.getElementById("cartList");
  const cartTotal = document.getElementById("cartTotal");
  const clearCart = document.getElementById("clearCart");
  const placeOrderBtn = document.getElementById("placeOrder");
  const cartCountBadge = document.getElementById("cartCountBadge");
  const cartETAEl = document.getElementById("cartETA");
  const cartSummaryEl = document.getElementById("cartSummary");

  let selectedCategory = "";
  let filtered = [];
  let currentPage = 1;
  const itemsPerPage = 9;

  let CART = JSON.parse(sessionStorage.getItem("jc_cart") || "[]");
  function saveCart() {
    sessionStorage.setItem("jc_cart", JSON.stringify(CART));
  }
  function cartCount() {
    return CART.reduce((s, i) => s + i.qty, 0);
  }

  function updateCartBadge() {
    if (!cartCountBadge) return;
    const c = cartCount();
    if (c > 0) {
      cartCountBadge.style.display = "inline-block";
      cartCountBadge.textContent = c;
      cartCountBadge.setAttribute("aria-hidden", "false");
      cartCountBadge.setAttribute("aria-label", `${c} items in cart`);
    } else {
      cartCountBadge.style.display = "none";
      cartCountBadge.setAttribute("aria-hidden", "true");
      cartCountBadge.removeAttribute("aria-label");
    }
  }

  function updateCartSummary() {
    if (!cartSummaryEl) return;
    const count = cartCount();
    if (count === 0) {
      cartSummaryEl.textContent = "";
      cartSummaryEl.setAttribute("aria-hidden", "true");
    } else {
      const total = CART.reduce((s, i) => s + i.price * i.qty, 0);
      cartSummaryEl.textContent = `${count} • ${priceFormatter.format(total)}`;
      cartSummaryEl.setAttribute("aria-hidden", "false");
    }
  }

  function populateCategories() {
    const cats = Array.from(new Set(allData.map((i) => i.category))).filter(
      Boolean
    );
    if (!categoryContainer) return;
    categoryContainer.innerHTML = "";
    cats.forEach((cat) => {
      const btn = document.createElement("div");
      btn.className = "category-btn";
      // const imgSrc =
      //   (allData.find((x) => x.category === cat) || {}).image ||
      //   "owl-logo.webp";
      // btn.innerHTML = `<div class="category-circle"><img src="${imgSrc}" alt="${cat}"></div><div class="category-label">${cat}</div>`;
      const imgSrc =
        (allData.find((x) => x.category === cat) || {}).image ||
        "owl-logo.webp";

      btn.innerHTML = `<div class="category-circle"></div><div class="category-label">${cat}</div>`;
      const circle = btn.querySelector(".category-circle");
      const img = document.createElement("img");
      prepareLazyImage(img, imgSrc, { alt: cat, errorSrc: "owl-logo.webp" });
      circle.appendChild(img);

      btn.addEventListener("click", () => {
        selectedCategory = selectedCategory === cat ? "" : cat;
        document
          .querySelectorAll(".category-btn")
          .forEach((b) => b.classList.remove("active"));
        if (selectedCategory) btn.classList.add("active");
        applyFilters();
      });
      categoryContainer.appendChild(btn);
    });
  }

  function createCard(item) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = item.id;

    const imgWrap = document.createElement("div");
    imgWrap.className = "img-wrap";
    // const img = document.createElement("img");
    // img.alt = item.name;
    // img.src = item.image || "owl-logo.webp";
    // img.onerror = () => (img.src = "owl-logo.webp");
    const img = document.createElement("img");
    prepareLazyImage(img, item.image || "owl-logo.webp", {
      alt: item.name,
      errorSrc: "owl-logo.webp",
    });

    imgWrap.appendChild(img);

    const pricePill = document.createElement("div");
    pricePill.className = "price-pill";
    pricePill.textContent = priceFormatter.format(item.price || 0);
    imgWrap.appendChild(pricePill);

    const isHidden = !!hiddenMap.get(String(item.id));
    if (isHidden) {
      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "absolute",
        inset: "0",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0.6))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: "800",
        color: "#9b1b1b",
        fontSize: "14px",
        textTransform: "uppercase",
        letterSpacing: "0.6px",
        pointerEvents: "none",
      });
      overlay.textContent = "Unavailable";
      imgWrap.appendChild(overlay);
    }

    if (item.popular) {
      const badge = document.createElement("div");
      badge.className = "card-badge";
      badge.textContent = "Popular";
      imgWrap.appendChild(badge);
    }

    const content = document.createElement("div");
    content.className = "card-content";
    const title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = item.name;

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.innerHTML = `<p>${item.description || ""}${
      item.prep ? " • " + item.prep : ""
    }</p>`;

    const bottom = document.createElement("div");
    bottom.className = "bottom-row";

    const addBtn = document.createElement("button");
    addBtn.className = "add-btn";
    addBtn.innerHTML = "Add";
    addBtn.setAttribute("aria-label", `Add ${item.name} to cart`);

    if (isHidden) {
      addBtn.disabled = true;
      addBtn.textContent = "Unavailable";
      addBtn.style.opacity = "0.8";
      addBtn.style.cursor = "not-allowed";
    } else {
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        addToCart(item);
      });
    }

    bottom.appendChild(addBtn);

    content.appendChild(title);
    content.appendChild(meta);
    content.appendChild(bottom);

    card.appendChild(imgWrap);
    card.appendChild(content);
    return card;
  }

  function renderPopular() {
    const popularItems = allData.filter((i) => i.popular);
    if (!popularContainer) return;
    popularContainer.innerHTML = "";
    popularItems.forEach((it) => {
      const c = createCard(it);
      c.classList.add("popular-card");
      c.style.minWidth = "240px";
      popularContainer.appendChild(c);
    });
  }

  function renderAll(data) {
    if (!allContainer) return;
    allContainer.innerHTML = "";
    const start = (currentPage - 1) * itemsPerPage;
    const pageItems = data.slice(start, start + itemsPerPage);
    if (!pageItems.length) {
      allContainer.innerHTML =
        '<div class="empty-msg">No items matched your search.</div>';
      return;
    }
    pageItems.forEach((it) => allContainer.appendChild(createCard(it)));
    renderPagination(data.length);
  }

  function renderPagination(total) {
    const pag = document.getElementById("pagination");
    if (!pag) return;
    pag.innerHTML = "";
    const totalPages = Math.max(1, Math.ceil(total / itemsPerPage));
    if (totalPages <= 1) return;
    for (let i = 1; i <= totalPages; i++) {
      const b = document.createElement("button");
      b.textContent = i;
      if (i === currentPage) b.classList.add("active");
      b.addEventListener("click", () => {
        currentPage = i;
        renderAll(filtered.length ? filtered : allData);
        window.scrollTo({ top: 200, behavior: "smooth" });
      });
      pag.appendChild(b);
    }
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }
  const debouncedApply = debounce(() => applyFilters(), 220);

  function applyFilters() {
    const q = (searchInput?.value || "").trim().toLowerCase();
    filtered = allData.filter((item) => {
      const matchCat = selectedCategory
        ? item.category === selectedCategory
        : true;
      const inName = item.name && item.name.toLowerCase().includes(q);
      const inDesc =
        item.description && item.description.toLowerCase().includes(q);
      const inPrep = item.prep && item.prep.toLowerCase().includes(q);
      const inTags =
        item.tags && item.tags.some((t) => t.toLowerCase().includes(q));
      const tokens = q.split(/\s+/).filter(Boolean);
      const tokenMatch = tokens.length
        ? tokens.every((tk) =>
            [
              item.name,
              item.description,
              item.prep,
              (item.tags || []).join(" "),
            ].some((field) =>
              String(field || "")
                .toLowerCase()
                .includes(tk)
            )
          )
        : true;
      const matchSearch = q
        ? inName || inDesc || inPrep || inTags || tokenMatch
        : true;
      return matchCat && matchSearch;
    });
    currentPage = 1;
    renderAll(filtered.length ? filtered : allData);
  }

  function addToCart(item) {
    const isHidden = !!hiddenMap.get(String(item.id));
    if (isHidden) {
      showToast(`"${item.name}" is currently unavailable`);
      return;
    }
    const existing = CART.find((c) => c.id === item.id);
    if (existing) existing.qty += 1;
    else CART.push({ id: item.id, name: item.name, price: item.price, qty: 1 });
    saveCart();
    renderCart();
    pulseCartBadge();
  }

  function pulseCartBadge() {
    if (!cartCountBadge) return;
    cartCountBadge.classList.add("pulse");
    setTimeout(() => cartCountBadge.classList.remove("pulse"), 300);
  }

  function renderCart() {
    if (!cartList || !cartTotal || !cartETAEl) return;
    cartList.innerHTML = "";
    if (!CART.length) {
      cartList.innerHTML = '<div class="small">Your cart is empty</div>';
      cartTotal.textContent = "₹0";
      cartETAEl.textContent = "ETA: —";
      updateCartBadge();
      updateCartSummary();
      return;
    }

    CART.forEach((c, idx) => {
      const item = allData.find((d) => d.id === c.id) || {};
      const div = document.createElement("div");
      div.className = "cart-item";
      div.innerHTML = `
        <div style="flex:1">
          <strong>${c.name}</strong>
          <div class="small">₹${c.price} × ${c.qty} • ${
        item.prep ? item.prep : ""
      }</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="qty-dec" data-idx="${idx}" title="Decrease">−</button>
          <input type="number" min="1" value="${
            c.qty
          }" data-idx="${idx}" style="width:56px;padding:6px;border-radius:6px;border:1px solid rgba(17,17,17,0.06)"/>
          <button class="qty-inc" data-idx="${idx}" title="Increase">+</button>
          <button class="remove" data-idx="${idx}" style="background:#fff;color:#333;border-radius:6px;padding:6px 8px">Remove</button>
        </div>
      `;
      cartList.appendChild(div);
    });

    cartList.querySelectorAll('input[type="number"]').forEach((inp) => {
      inp.addEventListener("change", (e) => {
        const idx = Number(e.target.dataset.idx);
        const val = Math.max(1, Number(e.target.value || 1));
        CART[idx].qty = val;
        saveCart();
        renderCart();
      });
    });
    cartList.querySelectorAll(".qty-dec").forEach((b) =>
      b.addEventListener("click", (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        CART[idx].qty = Math.max(1, CART[idx].qty - 1);
        saveCart();
        renderCart();
      })
    );
    cartList.querySelectorAll(".qty-inc").forEach((b) =>
      b.addEventListener("click", (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        CART[idx].qty = CART[idx].qty + 1;
        saveCart();
        renderCart();
      })
    );
    cartList.querySelectorAll(".remove").forEach((b) =>
      b.addEventListener("click", (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        CART.splice(idx, 1);
        saveCart();
        renderCart();
      })
    );

    const total = CART.reduce((s, i) => s + i.price * i.qty, 0);
    cartTotal.textContent = `₹${total}`;
    const eta = computeCartETA(CART);
    cartETAEl.textContent = "ETA: " + eta.label;
    updateCartBadge();
    updateCartSummary();
  }

  function firstFocusable(container) {
    if (!container) return null;
    const sel =
      'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return container.querySelector(sel);
  }
  function listFocusable(container) {
    if (!container) return [];
    const sel =
      'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll(sel)).filter(
      (el) => el.offsetParent !== null
    );
  }

  function lockBodyScroll() {
    const doc = document.documentElement;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    doc.style.setProperty("--saved-scroll-y", `${scrollY}`);
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.overflow = "hidden";
    document.body.classList.add("no-scroll-when-drawer");
  }
  function unlockBodyScroll() {
    const doc = document.documentElement;
    const saved =
      parseInt(getComputedStyle(doc).getPropertyValue("--saved-scroll-y")) || 0;
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.overflow = "";
    document.body.classList.remove("no-scroll-when-drawer");
    window.scrollTo(0, saved);
  }

  let _trapHandler = null;

  function openDrawer() {
    if (!drawer) return;
    drawer.classList.add("open");
    drawerOverlay?.classList.add("active");
    document.body.classList.add("drawer-open");

    drawer.removeAttribute("aria-hidden");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("role", "dialog");

    lockBodyScroll();

    const target = firstFocusable(drawer) || drawer;
    try {
      if (!target.hasAttribute("tabindex"))
        target.setAttribute("tabindex", "-1");
      target.focus();
    } catch (e) {}

    _trapHandler = function (ev) {
      if (ev.key !== "Tab") return;
      const nodes = listFocusable(drawer);
      if (!nodes.length) {
        ev.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", _trapHandler);
  }

  function closeDrawer() {
    if (!drawer) return;

    const active = document.activeElement;
    if (active && drawer.contains(active)) {
      try {
        if (openCartBtn && typeof openCartBtn.focus === "function") {
          openCartBtn.focus();
        } else {
          active.blur();
        }
      } catch (e) {
        try {
          active.blur();
        } catch {}
      }
    }

    drawer.classList.remove("open");
    drawerOverlay?.classList.remove("active");
    document.body.classList.remove("drawer-open");

    drawer.setAttribute("aria-hidden", "true");
    drawer.setAttribute("aria-modal", "false");

    if (_trapHandler) {
      document.removeEventListener("keydown", _trapHandler);
      _trapHandler = null;
    }

    unlockBodyScroll();
  }

  if (openCartBtn) {
    openCartBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openDrawer();
    });
  }
  if (closeDrawerBtn) {
    closeDrawerBtn.addEventListener("click", (e) => {
      e.preventDefault();
      closeDrawer();
    });
  }
  if (drawerOverlay) {
    drawerOverlay.addEventListener("click", (e) => {
      e.preventDefault();
      closeDrawer();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer && drawer.classList.contains("open")) {
      closeDrawer();
    }
  });

  let isPlacing = false;
  placeOrderBtn?.addEventListener("click", async () => {
    if (isPlacing) return;
    if (!CART.length) {
      showToast("Cart empty");
      return;
    }
    isPlacing = true;
    placeOrderBtn.disabled = true;
    const originalText = placeOrderBtn.textContent;
    placeOrderBtn.textContent = "Placing…";

    const table = qs("table") || "TAKEAWAY";
    const etaObj = computeCartETA(CART);
    const order = {
      table,
      items: CART.map((c) => ({
        id: c.id,
        name: c.name,
        qty: c.qty,
        price: c.price,
      })),
      created: nowISO(),
      status: "Pending",
      paid: false,
      etaMinutes: etaObj.totalMins,
      etaLabel: etaObj.label,
    };

    try {
      const docRef = await addDoc(ordersCol, order);
      const orderId = docRef?.id || null;
      showToast(
        orderId
          ? `Order placed — #${orderId} • ETA ${etaObj.label}`
          : `Order placed — ETA ${etaObj.label}`,
        4500
      );
      CART = [];
      saveCart();
      renderCart();
      setTimeout(() => closeDrawer(), 600);
    } catch (err) {
      console.error("order failed", err);
      showToast("Failed to place order — try again");
    } finally {
      isPlacing = false;
      placeOrderBtn.disabled = false;
      placeOrderBtn.textContent = originalText;
    }
  });

  clearCart?.addEventListener("click", () => {
    CART = [];
    saveCart();
    renderCart();
    showToast("Cart cleared");
  });
  searchInput?.addEventListener("input", debouncedApply);

  window.addEventListener("items-hidden-updated", () => {
    populateCategories();
    renderPopular();
    applyFilters();

    const removed = CART.filter((ci) => hiddenMap.get(String(ci.id)));
    if (removed.length) {
      CART = CART.filter((ci) => !hiddenMap.get(String(ci.id)));
      saveCart();
      renderCart();
      const names = removed.map((r) => r.name).slice(0, 10);
      showToast(`Removed unavailable from cart: ${names.join(", ")}`, 4500);
    } else {
      renderCart();
    }
  });

  populateCategories();
  renderPopular();
  applyFilters();
  renderCart();
}

function initKDSPage() {
  const container = document.getElementById("kdsContainer");
  const q = query(ordersCol, orderBy("created", "desc"));
  onSnapshot(q, (snap) => {
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const active = docs.filter(
      (o) => String(o.status || "").toLowerCase() !== "served"
    );
    renderKDS(active);
  });

  function renderKDS(orders) {
    container.innerHTML = "";
    if (!orders.length) {
      const empty = document.createElement("div");
      empty.className = "small";
      empty.textContent = "No active orders";
      container.appendChild(empty);
      return;
    }
    orders.forEach((o) => container.appendChild(renderOrderCard(o)));
  }

  function safePrepText(raw) {
    let t = raw ?? "";
    if (typeof t !== "string") t = String(t);
    return t.trim();
  }

  function renderOrderCard(order) {
    const card = document.createElement("div");
    card.className = "card";
    const metaRow = document.createElement("div");
    metaRow.className = "card-meta-row";
    const leftMeta = document.createElement("div");
    leftMeta.className = "left-meta";
    const idEl = document.createElement("div");
    idEl.className = "order-id";
    idEl.textContent = `#${order.id}`;
    const tableEl = document.createElement("div");
    tableEl.className = "meta-small";
    tableEl.textContent = `Table: ${order.table || "—"}`;
    const timeEl = document.createElement("div");
    timeEl.className = "meta-small";
    try {
      timeEl.textContent = new Date(order.created).toLocaleTimeString();
    } catch {
      timeEl.textContent = order.created || "—";
    }
    leftMeta.appendChild(idEl);
    leftMeta.appendChild(tableEl);
    leftMeta.appendChild(timeEl);
    const etaEl = document.createElement("div");
    etaEl.className = "meta-small";
    etaEl.textContent =
      order.etaLabel || (order.etaMinutes ? `${order.etaMinutes} min` : "—");
    metaRow.appendChild(leftMeta);
    metaRow.appendChild(etaEl);

    const itemsWrap = document.createElement("div");
    itemsWrap.className = "items";
    (order.items || []).forEach((it) => {
      const row = document.createElement("div");
      row.className = "item-row";
      const qty = document.createElement("div");
      qty.className = "item-qty";
      qty.textContent = it.qty ?? 1;
      const name = document.createElement("div");
      name.className = "item-name";
      name.textContent = it.name || "Unnamed";
      let prepText = it.prep ?? it.preparation ?? "";
      prepText = safePrepText(prepText);
      const prep = document.createElement("div");
      prep.className = "item-prep";
      if (prepText) prep.textContent = prepText;

      row.appendChild(qty);
      row.appendChild(name);

      if (hiddenMap.get(String(it.id))) {
        const b = document.createElement("div");
        b.className = "unavailable-badge";
        b.textContent = "UNAVAILABLE";
        row.appendChild(b);
      }

      if (prepText) row.appendChild(prep);
      itemsWrap.appendChild(row);
    });

    const footer = document.createElement("div");
    footer.className = "card-footer";
    const notes = document.createElement("div");
    notes.textContent = order.notes ? `Notes: ${order.notes}` : "";
    const doneBtn = document.createElement("button");
    doneBtn.className = "drawer-close";
    doneBtn.textContent = "Done";
    doneBtn.addEventListener("click", async () => {
      doneBtn.disabled = true;
      doneBtn.textContent = "Removing…";
      try {
        const ref = doc(db, "orders", order.id);
        await deleteDoc(ref);
        showToast(`Order ${order.id} removed`, 2200);
      } catch (err) {
        console.error("delete failed", err);
        showToast("Failed to remove order");
        doneBtn.disabled = false;
        doneBtn.textContent = "Done";
      }
    });

    footer.appendChild(notes);
    footer.appendChild(doneBtn);
    card.appendChild(metaRow);
    card.appendChild(itemsWrap);
    card.appendChild(footer);
    return card;
  }
}

fetchAndInit();
