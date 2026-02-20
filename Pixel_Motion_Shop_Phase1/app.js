let supabase;

function mustConfig() {
  const c = window.APP_CONFIG || {};
  return c.SUPABASE_URL && c.SUPABASE_ANON_KEY &&
         !c.SUPABASE_URL.includes("PASTE_") && !c.SUPABASE_ANON_KEY.includes("PASTE_");
}

function moneyTHBFromCents(cents) {
  const thb = cents / 100;
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(thb);
}

function thbToCents(thb) {
  const n = Number(thb);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function qs(k) { return new URLSearchParams(location.search).get(k); }

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

async function initSupabase() {
  if (!mustConfig()) return;
  await new Promise(r => setTimeout(r, 0)); // let deferred scripts load
  supabase = window.supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY);
}

async function ensureProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (profile) return profile;

  const display = user.email?.split("@")[0] || "user";
  const { data: created, error } = await supabase
    .from("profiles")
    .insert({ id: user.id, display_name: display, role: "buyer" })
    .select("*")
    .single();
  if (error) throw error;
  return created;
}

async function refreshAuthButton() {
  const btn = document.getElementById("btnAuth");
  if (!btn || !supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    btn.textContent = "Logout";
    btn.onclick = async () => { await supabase.auth.signOut(); location.href = "./index.html"; };
  } else {
    btn.textContent = "Login";
    btn.onclick = () => openAuthModal();
  }
}

function openAuthModal() {
  const html = `
    <div id="authModal" class="fixed inset-0 bg-black/40 p-4 flex items-center justify-center z-50">
      <div class="bg-white rounded-2xl shadow p-5 w-full max-w-md">
        <div class="flex items-center justify-between">
          <div class="font-bold text-lg">Login / Sign up</div>
          <button id="closeAuth" class="px-2 py-1 rounded bg-gray-100">✕</button>
        </div>
        <div class="mt-4">
          <label class="text-sm font-semibold">Email</label>
          <input id="authEmail" class="w-full border rounded-lg p-2 mt-1" placeholder="you@example.com" />
        </div>
        <div class="mt-3">
          <label class="text-sm font-semibold">Password</label>
          <input id="authPass" type="password" class="w-full border rounded-lg p-2 mt-1" placeholder="••••••••" />
        </div>
        <div class="mt-4 flex gap-2">
          <button id="btnLogin" class="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">Login</button>
          <button id="btnSignup" class="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200">Sign up</button>
        </div>
        <div id="authMsg" class="text-sm text-gray-700 mt-3"></div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", html);
  const modal = document.getElementById("authModal");
  document.getElementById("closeAuth").onclick = () => modal.remove();
  const msg = (t) => (document.getElementById("authMsg").textContent = t);

  document.getElementById("btnLogin").onclick = async () => {
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPass").value;
    msg("Logging in...");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return msg(error.message);
    await ensureProfile();
    await refreshAuthButton();
    modal.remove();
    location.reload();
  };

  document.getElementById("btnSignup").onclick = async () => {
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPass").value;
    msg("Signing up...");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return msg(error.message);
    msg("Signed up. If email confirmation is on, confirm email then login.");
  };
}

async function listProducts(query) {
  const box = document.getElementById("products");
  const empty = document.getElementById("empty");
  if (!box) return;

  let q = supabase.from("products")
    .select("id,title,description,price_cents,cover_path,created_at")
    .eq("status","active")
    .order("created_at", { ascending: false })
    .limit(60);

  if (query) q = q.ilike("title", `%${query}%`);

  const { data, error } = await q;
  if (error) throw error;

  box.innerHTML = "";
  if (!data || data.length === 0) { empty?.classList.remove("hidden"); return; }
  empty?.classList.add("hidden");

  for (const p of data) {
    const coverUrl = p.cover_path
      ? supabase.storage.from("product-covers").getPublicUrl(p.cover_path).data.publicUrl
      : "";

    const card = document.createElement("div");
    card.className = "bg-gray-50 rounded-2xl p-4 border";
    card.innerHTML = `
      ${coverUrl ? `<img src="${coverUrl}" class="w-full h-40 object-cover rounded-xl mb-3" />`
                 : `<div class="w-full h-40 bg-gray-200 rounded-xl mb-3"></div>`}
      <div class="font-bold">${escapeHtml(p.title)}</div>
      <div class="text-sm text-gray-600 mt-1">${escapeHtml(p.description || "")}</div>
      <div class="mt-3 flex items-center justify-between gap-2">
        <div class="font-semibold">${moneyTHBFromCents(p.price_cents)}</div>
        <a class="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm" href="./checkout.html?product=${p.id}">Buy</a>
      </div>
    `;
    box.appendChild(card);
  }
}

async function sellerPage() {
  const btn = document.getElementById("btnCreateProduct");
  if (!btn) return;
  const msgEl = document.getElementById("sellMsg");
  const setMsg = (t) => (msgEl.textContent = t);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return setMsg("Please login first.");

  await ensureProfile();
  await loadMyProducts();

  btn.onclick = async () => {
    try {
      setMsg("Publishing...");
      const title = document.getElementById("pTitle").value.trim();
      const priceCents = thbToCents(document.getElementById("pPrice").value);
      const desc = document.getElementById("pDesc").value.trim();
      const coverFile = document.getElementById("pCover").files?.[0] || null;
      const dataFile  = document.getElementById("pFile").files?.[0] || null;

      if (!title) return setMsg("Title required.");
      if (priceCents === null) return setMsg("Invalid price.");
      if (!dataFile) return setMsg("Digital file required.");

      // create product first (temp file_path)
      const { data: prod, error: e1 } = await supabase.from("products").insert({
        seller_id: user.id,
        title,
        description: desc,
        price_cents: priceCents,
        file_path: "temp"
      }).select("*").single();
      if (e1) throw e1;

      const safeName = dataFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `${user.id}/${prod.id}/${Date.now()}_${safeName}`;
      const { error: eUp } = await supabase.storage.from("product-files").upload(filePath, dataFile, { upsert: false });
      if (eUp) throw eUp;

      let coverPath = null;
      if (coverFile) {
        const cName = coverFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        coverPath = `${user.id}/${prod.id}/${Date.now()}_${cName}`;
        const { error: eC } = await supabase.storage.from("product-covers").upload(coverPath, coverFile, { upsert: false });
        if (eC) throw eC;
      }

      const { error: e2 } = await supabase.from("products").update({ file_path: filePath, cover_path: coverPath }).eq("id", prod.id);
      if (e2) throw e2;

      setMsg("Published!");
      document.getElementById("pTitle").value = "";
      document.getElementById("pPrice").value = "";
      document.getElementById("pDesc").value = "";
      document.getElementById("pCover").value = "";
      document.getElementById("pFile").value = "";
      await loadMyProducts();
    } catch (err) {
      setMsg(err?.message || String(err));
    }
  };

  async function loadMyProducts() {
    const grid = document.getElementById("myProducts");
    const empty = document.getElementById("myEmpty");
    const { data, error } = await supabase.from("products").select("*").eq("seller_id", user.id).order("created_at",{ascending:false});
    if (error) return setMsg(error.message);
    grid.innerHTML = "";
    if (!data || data.length === 0) { empty.classList.remove("hidden"); return; }
    empty.classList.add("hidden");

    for (const p of data) {
      const coverUrl = p.cover_path ? supabase.storage.from("product-covers").getPublicUrl(p.cover_path).data.publicUrl : "";
      const card = document.createElement("div");
      card.className = "bg-gray-50 rounded-2xl p-4 border";
      card.innerHTML = `
        ${coverUrl ? `<img src="${coverUrl}" class="w-full h-32 object-cover rounded-xl mb-3" />`
                   : `<div class="w-full h-32 bg-gray-200 rounded-xl mb-3"></div>`}
        <div class="font-bold">${escapeHtml(p.title)}</div>
        <div class="text-sm text-gray-600 mt-1">${moneyTHBFromCents(p.price_cents)}</div>
        <div class="text-xs text-gray-500 mt-1">Status: ${p.status}</div>
      `;
      grid.appendChild(card);
    }
  }
}

async function checkoutPage() {
  const box = document.getElementById("checkoutBox");
  if (!box) return;

  const productId = qs("product");
  if (!productId) return (box.textContent = "Missing product id.");

  const { data: p, error } = await supabase.from("products").select("*").eq("id", productId).single();
  if (error) return (box.textContent = error.message);

  const feePct = Number(APP_CONFIG.PLATFORM_FEE_PERCENT || 10);
  const platformFee = Math.round(p.price_cents * (feePct / 100));
  const sellerAmount = p.price_cents - platformFee;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    box.innerHTML = `<div class="text-sm text-gray-700">Please login to buy.</div>
                     <button class="mt-3 px-4 py-2 rounded-lg bg-blue-600 text-white" id="btnNeedLogin">Login</button>`;
    document.getElementById("btnNeedLogin").onclick = openAuthModal;
    return;
  }
  await ensureProfile();

  const { data: order, error: e1 } = await supabase.from("orders").insert({
    buyer_id: user.id,
    product_id: p.id,
    price_cents: p.price_cents,
    platform_fee_cents: platformFee,
    seller_amount_cents: sellerAmount,
    status: "pending_payment"
  }).select("*").single();
  if (e1) return (box.textContent = e1.message);

  box.innerHTML = `
    <div class="bg-gray-50 border rounded-2xl p-4">
      <div class="font-bold text-lg">Order created</div>
      <div class="text-sm text-gray-600 mt-1">Order ID: <span class="font-mono">${order.id}</span></div>

      <div class="mt-3 grid sm:grid-cols-2 gap-4">
        <div>
          <div class="text-sm font-semibold">Product</div>
          <div class="text-sm">${escapeHtml(p.title)}</div>
          <div class="mt-2 text-sm font-semibold">Amount (THB)</div>
          <div class="text-xl font-bold">${moneyTHBFromCents(order.price_cents)}</div>
          <div class="text-xs text-gray-500 mt-2">Fee: ${moneyTHBFromCents(order.platform_fee_cents)} • Seller: ${moneyTHBFromCents(order.seller_amount_cents)}</div>
        </div>
        <div>
          <div class="text-sm font-semibold">Pay via PromptPay (manual verify)</div>
          <div class="text-sm text-gray-700 mt-1">Pay to: <span class="font-semibold">${escapeHtml(APP_CONFIG.PROMPTPAY_DISPLAY_NAME || "PromptPay")}</span></div>
          <div class="text-sm text-gray-700">PromptPay ID: <span class="font-mono">${escapeHtml(APP_CONFIG.PROMPTPAY_ID || "NOT_SET")}</span></div>
          <div class="text-xs text-gray-500 mt-2">After paying, upload your slip below.</div>
        </div>
      </div>

      <div class="mt-4">
        <label class="text-sm font-semibold">Upload slip</label>
        <input id="slipFile" type="file" accept="image/*,application/pdf" class="w-full mt-2" />
        <textarea id="slipNote" class="w-full border rounded-lg p-2 mt-2 text-sm" rows="2" placeholder="Optional note"></textarea>
        <div class="mt-3 flex gap-2 items-center">
          <button id="btnSubmitSlip" class="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">Submit for review</button>
          <div id="slipMsg" class="text-sm text-gray-700"></div>
        </div>
      </div>
    </div>
  `;

  const slipMsg = (t) => (document.getElementById("slipMsg").textContent = t);

  document.getElementById("btnSubmitSlip").onclick = async () => {
    const f = document.getElementById("slipFile").files?.[0] || null;
    const note = document.getElementById("slipNote").value.trim();
    if (!f) return slipMsg("Slip required.");

    try {
      slipMsg("Uploading...");
      const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const slipPath = `${user.id}/${order.id}/${Date.now()}_${safe}`;
      const { error: eUp } = await supabase.storage.from("payment-slips").upload(slipPath, f, { upsert: false });
      if (eUp) throw eUp;

      const { error: e2 } = await supabase.from("orders").update({
        slip_path: slipPath,
        note,
        status: "pending_review"
      }).eq("id", order.id);
      if (e2) throw e2;

      slipMsg("Submitted. Wait for admin approval.");
    } catch (err) {
      slipMsg(err?.message || String(err));
    }
  };
}

async function ordersPage() {
  const box = document.getElementById("orders");
  const empty = document.getElementById("ordersEmpty");
  if (!box) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return (box.innerHTML = `<div class="text-sm text-gray-700">Please login to view orders.</div>`);
  await ensureProfile();

  const { data, error } = await supabase
    .from("orders")
    .select("id,status,price_cents,created_at,products(title,file_path)")
    .order("created_at", { ascending: false });

  if (error) return (box.textContent = error.message);

  box.innerHTML = "";
  if (!data || data.length === 0) { empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  for (const o of data) {
    const canDownload = o.status === "paid";
    const card = document.createElement("div");
    card.className = "bg-gray-50 border rounded-2xl p-4";
    card.innerHTML = `
      <div class="flex flex-wrap justify-between gap-2">
        <div>
          <div class="font-bold">${escapeHtml(o.products?.title || "Product")}</div>
          <div class="text-xs text-gray-500 mt-1">Order: <span class="font-mono">${o.id}</span></div>
        </div>
        <div class="text-right">
          <div class="font-semibold">${moneyTHBFromCents(o.price_cents)}</div>
          <div class="text-xs mt-1">Status: <span class="font-semibold">${o.status}</span></div>
        </div>
      </div>
      <div class="mt-3">
        ${canDownload ? `<button class="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm" data-dl="${escapeHtml(o.products?.file_path || "")}">Download</button>`
                      : `<div class="text-sm text-gray-600">Download after approval.</div>`}
      </div>
    `;
    box.appendChild(card);
  }

  box.querySelectorAll("button[data-dl]").forEach(btn => {
    btn.onclick = async () => {
      const path = btn.getAttribute("data-dl");
      if (!path) return;
      btn.disabled = true; btn.textContent = "Downloading...";
      try {
        const { data, error } = await supabase.storage.from("product-files").download(path);
        if (error) throw error;
        const url = URL.createObjectURL(data);
        const a = document.createElement("a");
        a.href = url;
        a.download = path.split("/").pop() || "download";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        alert(err?.message || String(err));
      } finally {
        btn.disabled = false; btn.textContent = "Download";
      }
    };
  });
}

async function adminPage() {
  const pending = document.getElementById("pending");
  const empty = document.getElementById("pendingEmpty");
  const adminMsg = document.getElementById("adminMsg");
  if (!pending) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return (adminMsg.textContent = "Please login as admin.");

  const profile = await ensureProfile();
  if (profile.role !== "admin") return (adminMsg.textContent = "Not an admin. Set role='admin' in profiles table.");

  const { data, error } = await supabase
    .from("orders")
    .select("id,buyer_id,status,price_cents,slip_path,note,created_at,products(title)")
    .eq("status","pending_review")
    .order("created_at",{ascending:true});

  if (error) return (adminMsg.textContent = error.message);

  pending.innerHTML = "";
  if (!data || data.length === 0) { empty.classList.remove("hidden"); adminMsg.textContent=""; return; }
  empty.classList.add("hidden");
  adminMsg.textContent = "";

  for (const o of data) {
    const card = document.createElement("div");
    card.className = "bg-gray-50 border rounded-2xl p-4";
    card.innerHTML = `
      <div class="flex flex-wrap justify-between gap-2">
        <div>
          <div class="font-bold">${escapeHtml(o.products?.title || "")}</div>
          <div class="text-xs text-gray-500 mt-1">Order: <span class="font-mono">${o.id}</span></div>
          <div class="text-xs text-gray-500">Buyer: <span class="font-mono">${o.buyer_id}</span></div>
        </div>
        <div class="text-right">
          <div class="font-semibold">${moneyTHBFromCents(o.price_cents)}</div>
          <div class="text-xs mt-1">Status: <span class="font-semibold">${o.status}</span></div>
        </div>
      </div>
      <div class="text-sm text-gray-700 mt-2">${escapeHtml(o.note || "")}</div>
      <div class="mt-3 flex flex-wrap gap-2 items-center">
        <button class="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm" data-slip="${escapeHtml(o.slip_path || "")}">View slip</button>
        <button class="px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 text-sm" data-approve="${o.id}">Approve</button>
        <button class="px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 text-sm" data-reject="${o.id}">Reject</button>
      </div>
    `;
    pending.appendChild(card);
  }

  pending.querySelectorAll("button[data-slip]").forEach(btn => {
    btn.onclick = async () => {
      const slipPath = btn.getAttribute("data-slip");
      if (!slipPath) return alert("No slip");
      btn.disabled = true; btn.textContent = "Loading...";
      try {
        const { data, error } = await supabase.storage.from("payment-slips").download(slipPath);
        if (error) throw error;
        const url = URL.createObjectURL(data);
        window.open(url, "_blank");
      } catch (err) {
        alert(err?.message || String(err));
      } finally {
        btn.disabled = false; btn.textContent = "View slip";
      }
    };
  });

  pending.querySelectorAll("button[data-approve]").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-approve");
      if (!confirm("Approve this order?")) return;
      const { error } = await supabase.from("orders").update({ status:"paid" }).eq("id", id);
      if (error) alert(error.message);
      location.reload();
    };
  });

  pending.querySelectorAll("button[data-reject]").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-reject");
      if (!confirm("Reject this order?")) return;
      const { error } = await supabase.from("orders").update({ status:"rejected" }).eq("id", id);
      if (error) alert(error.message);
      location.reload();
    };
  });
}

async function bootstrap() {
  await initSupabase();

  if (!mustConfig()) {
    const warn = document.createElement("div");
    warn.className = "max-w-5xl mx-auto mb-4 bg-yellow-50 border border-yellow-200 text-yellow-900 rounded-2xl p-4 text-sm";
    warn.innerHTML = `<div class="font-bold">Setup required</div>
      <div class="mt-1">Edit <span class="font-mono">config.js</span> and paste Supabase URL + anon key, plus PromptPay ID.</div>`;
    document.body.prepend(warn);
    return;
  }

  await refreshAuthButton();

  const page = location.pathname.split("/").pop() || "index.html";
  if (page === "index.html" || page === "") {
    document.getElementById("btnSearch")?.addEventListener("click", () => listProducts(document.getElementById("q").value.trim()));
    document.getElementById("q")?.addEventListener("keydown", (e) => { if (e.key === "Enter") listProducts(document.getElementById("q").value.trim()); });
    await listProducts("");
  }
  if (page === "seller.html") await sellerPage();
  if (page === "checkout.html") await checkoutPage();
  if (page === "orders.html") await ordersPage();
  if (page === "admin.html") await adminPage();
}

window.addEventListener("load", bootstrap);