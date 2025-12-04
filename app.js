// app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

/* ===== REPLACE with your Firebase config ===== */
const firebaseConfig = {
  apiKey: "AIzaSyAyyW44KAhKbl-pz5yXSlZveDJNAVETqpY",
  authDomain: "cafe-afe4b.firebaseapp.com",
  projectId: "cafe-afe4b",
  storageBucket: "cafe-afe4b.firebasestorage.app",
  messagingSenderId: "115862613556",
  appId: "1:115862613556:web:23e5fa5648137ff79d2461",
  measurementId: "G-3056BTEZPX",
};
/* ============================================= */

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

/* ------------------ Load and render products ------------------ */
let allData = [];
const priceFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

async function fetchAndInit() {
  try {
    const res = await fetch("data.json");
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

  if (document.body.dataset.page === "customer") initCustomerPage();
  if (document.body.dataset.page === "kds") initKDSPage();
}

/* ------------------ Helpers for prep parsing and ETA ------------------ */
function parsePrepMinutes(prepStr) {
  if (!prepStr) return 0;
  const m = String(prepStr).match(/(\d+)\s*(min|mins|minutes)?/i);
  if (m) return Number(m[1]);
  const m2 = String(prepStr).match(/(\d+)/);
  return m2 ? Number(m2[1]) : 0;
}

// ----- realistic ETA calculation -----
// Paste this in place of the old computeCartETA function
const DEFAULT_KITCHEN_CONCURRENCY = 3; // tune this to match your kitchen
const DEFAULT_BUFFER_MIN = 2; // minutes of overhead per order (packing/hand-off)

function computeCartETA(
  cart,
  concurrency = DEFAULT_KITCHEN_CONCURRENCY,
  bufferMin = DEFAULT_BUFFER_MIN
) {
  // cart: [{ id, qty, ... }, ... ]
  if (!Array.isArray(cart) || cart.length === 0) {
    return { totalMins: 0, label: "—" };
  }

  // gather prep minutes per item (single unit)
  const perItem = cart.map((it) => {
    const item = allData.find((d) => d.id === it.id);
    const mins = item ? parsePrepMinutes(item.prep) : 0;
    return { id: it.id, qty: it.qty, prep: Math.max(0, Number(mins) || 0) };
  });

  // total "work" in minutes (sum prep * qty)
  const totalWork = perItem.reduce((s, x) => s + x.prep * x.qty, 0);

  // longest single-item prep time (critical path)
  const maxPrep = perItem.reduce((m, x) => Math.max(m, x.prep), 0);

  // sanitize concurrency
  const K = Math.max(1, Math.floor(concurrency));

  if (totalWork <= 0) {
    return { totalMins: 0, label: "—" };
  }

  // If total work is less or equal to maxPrep, everything can effectively be finished
  // within that critical path (e.g., parallel tasks finished while the slowest cooks).
  let extra = 0;
  if (totalWork > maxPrep) {
    extra = Math.ceil((totalWork - maxPrep) / K);
  }

  const etaMinutes = maxPrep + extra + Math.max(0, Math.floor(bufferMin));
  const target = new Date(Date.now() + etaMinutes * 60000);

  return {
    totalMins: etaMinutes,
    label: `${etaMinutes} min (approx ${target.toLocaleTimeString()})`,
  };
}

/* ------------------ Customer (menu + cart) ------------------ */
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

  // improved badge update: show/hide, aria, and pulse (animation class assumed in CSS)
  function updateCartBadge() {
    const c = cartCount();
    if (!cartCountBadge) return;
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

  // live summary in bottom menu (e.g., "2 • ₹220")
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

  /* ---------- render helpers ---------- */
  function populateCategories() {
    const cats = Array.from(new Set(allData.map((i) => i.category))).filter(
      Boolean
    );
    if (!categoryContainer) return;
    categoryContainer.innerHTML = "";
    cats.forEach((cat) => {
      const btn = document.createElement("div");
      btn.className = "category-btn";
      const imgSrc =
        (allData.find((x) => x.category === cat) || {}).image ||
        "owl-logo.webp";
      btn.innerHTML = `<div class="category-circle"><img src="${imgSrc}" alt="${cat}"></div><div class="category-label">${cat}</div>`;
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

    // image area
    const imgWrap = document.createElement("div");
    imgWrap.className = "img-wrap";
    const img = document.createElement("img");
    img.alt = item.name;
    img.src = item.image || "owl-logo.webp";
    img.onerror = () => (img.src = "owl-logo.webp");
    imgWrap.appendChild(img);

    // price pill (keeps price visible but removes duplicate below)
    const pricePill = document.createElement("div");
    pricePill.className = "price-pill";
    pricePill.textContent = priceFormatter.format(item.price || 0);
    imgWrap.appendChild(pricePill);

    // popular badge
    if (item.popular) {
      const badge = document.createElement("div");
      badge.className = "card-badge";
      badge.textContent = "Popular";
      imgWrap.appendChild(badge);
    }

    // content
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

    // bottom row
    const bottom = document.createElement("div");
    bottom.className = "bottom-row";

    const addBtn = document.createElement("button");
    addBtn.className = "add-btn";
    addBtn.innerHTML = "Add";
    addBtn.setAttribute("aria-label", `Add ${item.name} to cart`);
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      addToCart(item);
    });

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

  // debounce
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

  /* ---------- CART logic ---------- */
  function addToCart(item) {
    const existing = CART.find((c) => c.id === item.id);
    if (existing) existing.qty += 1;
    else CART.push({ id: item.id, name: item.name, price: item.price, qty: 1 });
    saveCart();
    renderCart();
    pulseCartBadge();
    // showToast("Added to cart");
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

  // Drawer open/close (improved a bit)
  // Drawer open/close
  function lockBodyScroll() {
    // store current scroll position to prevent "jump" when unlocking
    const doc = document.documentElement;
    const scrollY = window.scrollY || window.pageYOffset;
    doc.style.setProperty("--saved-scroll-y", `${scrollY}px`);
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
    // restore scroll
    window.scrollTo(0, saved);
  }

  function openDrawer() {
    if (!drawer) return;
    drawer.classList.add("open");
    drawerOverlay?.classList.add("active");
    drawer.setAttribute("aria-hidden", "false");
    lockBodyScroll();
  }

  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove("open");
    drawerOverlay?.classList.remove("active");
    drawer.setAttribute("aria-hidden", "true");
    unlockBodyScroll();
  }

  // Place order (robust: prevent double submits, give feedback, preserve cart on fail)
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
          ? `Order placed — #${orderId} • ETA ${order.etaLabel}`
          : `Order placed — ETA ${order.etaLabel}`,
        4500
      );

      // clear cart only on success
      CART = [];
      saveCart();
      renderCart();

      // close drawer after brief confirmation time
      setTimeout(() => {
        closeDrawer();
      }, 600);
    } catch (err) {
      console.error("order failed", err);
      showToast("Failed to place order — try again");
      // keep cart intact for retry
    } finally {
      isPlacing = false;
      placeOrderBtn.disabled = false;
      placeOrderBtn.textContent = originalText;
    }
  });

  // events binding
  openCartBtn?.addEventListener("click", openDrawer);
  closeDrawerBtn?.addEventListener("click", closeDrawer);
  drawerOverlay?.addEventListener("click", closeDrawer);
  clearCart?.addEventListener("click", () => {
    CART = [];
    saveCart();
    renderCart();
    showToast("Cart cleared");
  });
  searchInput?.addEventListener("input", debouncedApply);

  // initial render
  populateCategories();
  renderPopular();
  applyFilters();
  renderCart();
}

function initKDSPage() {
  const container = document.getElementById("kdsContainer");
  // realtime listener ordered by created desc
  const q = query(ordersCol, orderBy("created", "desc"));
  onSnapshot(q, (snap) => {
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // remove served orders before rendering
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
    // render each order as its own card (vertical stacked)
    orders.forEach((o) => container.appendChild(renderOrderCard(o)));
  }

  function safePrepText(raw) {
    // avoid .trim() on non-strings
    let t = raw ?? "";
    if (typeof t !== "string") t = String(t);
    return t.trim();
  }

  function renderOrderCard(order) {
    const card = document.createElement("div");
    card.className = "card";
    // top meta row
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
    // show ETA label if available (from order doc), else compute approximately
    etaEl.textContent =
      order.etaLabel || (order.etaMinutes ? `${order.etaMinutes} min` : "—");

    metaRow.appendChild(leftMeta);
    metaRow.appendChild(etaEl);

    // items
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

      // SAFE PREP TEXT (no .trim() errors)
      let prepText = it.prep ?? it.preparation ?? "";
      prepText = safePrepText(prepText);

      const prep = document.createElement("div");
      prep.className = "item-prep";
      if (prepText) prep.textContent = prepText;

      row.appendChild(qty);
      row.appendChild(name);
      if (prepText) row.appendChild(prep);

      itemsWrap.appendChild(row);
    });

    // footer row: notes and Done button
    const footer = document.createElement("div");
    footer.className = "card-footer";

    const notes = document.createElement("div");
    notes.textContent = order.notes ? `Notes: ${order.notes}` : "";

    // Done button — permanently deletes the order document
    const doneBtn = document.createElement("button");
    doneBtn.className = "drawer-close"; // reuse existing style if desired
    doneBtn.textContent = "Done";
    doneBtn.style.background = "#fff";
    doneBtn.style.color = "#333";
    doneBtn.style.border = "1px solid rgba(17,17,17,0.06)";
    doneBtn.style.padding = "6px 10px";
    doneBtn.style.borderRadius = "8px";
    doneBtn.addEventListener("click", async () => {
      // optimistic UI: disable while deleting
      doneBtn.disabled = true;
      doneBtn.textContent = "Removing…";
      try {
        const ref = doc(db, "orders", order.id);
        await deleteDoc(ref);
        showToast(`Order ${order.id} removed`, 2200);
        // no need to manually remove from DOM — onSnapshot will update list
      } catch (err) {
        console.error("delete failed", err);
        showToast("Failed to remove order");
        doneBtn.disabled = false;
        doneBtn.textContent = "Done";
      }
    });

    footer.appendChild(notes);
    footer.appendChild(doneBtn);

    // attach everything
    card.appendChild(metaRow);
    card.appendChild(itemsWrap);
    card.appendChild(footer);

    return card;
  }
}

/* ------------------ entry ------------------ */
fetchAndInit();
