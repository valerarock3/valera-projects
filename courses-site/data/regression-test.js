const BASE = "http://localhost:3001";

let passed = 0, failed = 0;
const failures = [];

function cookieFrom(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return set.map(c => c.split(";")[0]).join("; ");
}

function makeClient() {
  let jar = "";
  const headersFor = (opts) => {
    const headers = { ...(opts.headers || {}) };
    if (opts.json) headers["Content-Type"] = "application/json";
    if (jar) headers["Cookie"] = jar;
    return headers;
  };
  const capture = (res) => {
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (set.length) jar = set.map(c => c.split(";")[0]).join("; ");
  };
  const f = async (path, opts = {}) => {
    const res = await fetch(BASE + path, {
      method: opts.method || "GET",
      headers: headersFor(opts),
      body: opts.json ? JSON.stringify(opts.json) : opts.body,
      redirect: "manual",
    });
    capture(res);
    let data = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) { try { data = await res.json(); } catch { data = null; } }
    return { status: res.status, data, headers: res.headers, url: res.url };
  };
  f.raw = async (path, opts = {}) => {
    const res = await fetch(BASE + path, {
      method: opts.method || "GET",
      headers: headersFor(opts),
      body: opts.json ? JSON.stringify(opts.json) : opts.body,
      redirect: opts.redirect || "manual",
    });
    capture(res);
    return res;
  };
  return f;
}

const T = (name, fn) => {
  try { fn(); passed++; }
  catch (e) { failed++; failures.push(`${name}: ${e.message}`); }
};

const TA = (name, promise) =>
  promise.then(() => { passed++; }).catch(e => { failed++; failures.push(`${name}: ${e.message}`); });

const eq = (actual, expected, msg) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const fails = (fn, msg) => {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(`${msg}: expected to throw`);
};

(async () => {
  const anon = makeClient();
  const user = makeClient();
  const admin = makeClient();
  const fresh = () => makeClient();

  // ===== 1. SMOKE: public pages =====
  const pages = ["/", "/index.html", "/catalog.html", "/products.html", "/services.html", "/consultation.html",
    "/reviews.html", "/login.html", "/register.html", "/forgot-password.html", "/cart.html", "/course.html",
    "/author.html", "/profile.html", "/item.html", "/admin.html", "/style.css", "/common.js", "/translations.js"];
  for (const p of pages) {
    await TA(`GET ${p} → 200`, (async () => {
      const r = await anon(p);
      eq(r.status, 200, `status`);
    })());
  }
  // 404 page for missing static
  await TA("GET /nope.html → 404", (async () => {
    const r = await anon("/nope.html");
    eq(r.status, 404, "status");
  })());

  // ===== 2. Public API =====
  const cat = await anon("/api/categories");
  await T("GET /api/categories → 200 array", () => { eq(cat.status, 200, "status"); ok(Array.isArray(cat.data), "array"); });

  const courses = await anon("/api/courses");
  await T("GET /api/courses → 200 array", () => { eq(courses.status, 200, "status"); ok(Array.isArray(courses.data), "array"); });
  const courseId = courses.data.length ? courses.data[0].id : null;

  await T("GET /api/courses?category → filter", async () => {
    if (!cat.data.length) { ok(true, "no categories, skip"); return; }
    const r = await anon("/api/courses?category=" + cat.data[0].id);
    eq(r.status, 200, "status");
  });

  const products = await anon("/api/products");
  const services = await anon("/api/services");
  const consults = await anon("/api/consultations");
  const siteReviews = await anon("/api/site-reviews");
  await T("GET products/services/consultations/reviews", () => {
    ok(Array.isArray(products.data) && Array.isArray(services.data) && Array.isArray(consults.data) && Array.isArray(siteReviews.data), "arrays");
  });

  const prodId = products.data.length ? products.data[0].id : null;
  const servId = services.data.length ? services.data[0].id : null;
  const consId = consults.data.length ? consults.data[0].id : null;

  // item detail per type
  if (prodId) await TA("GET /api/items/product/:id", (async () => { const r = await anon(`/api/items/product/${prodId}`); eq(r.status, 200, "status"); })());
  if (servId) await TA("GET /api/items/service/:id", (async () => { const r = await anon(`/api/items/service/${servId}`); eq(r.status, 200, "status"); })());
  if (consId) await TA("GET /api/items/consultation/:id", (async () => { const r = await anon(`/api/items/consultation/${consId}`); eq(r.status, 200, "status"); })());
  await TA("GET /api/items/product/999999 → 404", (async () => { const r = await anon("/api/items/product/999999"); eq(r.status, 404, "status"); })());

  // instructors (public list + detail)
  const inst = await anon("/api/instructors");
  await T("GET /api/instructors → 200 array", () => {
    eq(inst.status, 200, "status");
    ok(Array.isArray(inst.data), "array");
  });
  const instId = Array.isArray(inst.data) && inst.data.length ? inst.data[0].id : null;
  if (instId) await TA("GET /api/instructors/:id", (async () => { const r = await anon(`/api/instructors/${instId}`); eq(r.status, 200, "status"); })());

  // ===== 3. Course detail + views =====
  if (courseId) {
    const c1 = await anon(`/api/courses/${courseId}`);
    const c2 = await anon(`/api/courses/${courseId}`);
    await T("GET /api/courses/:id → 200 + views increment", () => {
      eq(c1.status, 200, "status");
      ok(typeof c1.data.views === "number", "views present");
      ok(Number(c2.data.views) > Number(c1.data.views), `views incremented (${c1.data.views} → ${c2.data.views})`);
    });
  }
  await TA("GET /api/courses/999999 → 404", (async () => { const r = await anon("/api/courses/999999"); eq(r.status, 404, "status"); })());

  // ===== 4. Auth =====
  const ts = Date.now();
  const email = `reg_${ts}@test.ru`;
  const phone = `79${String(ts).slice(-9)}`;

  await TA("register: missing fields → 400", (async () => {
    const r = await anon("/api/register", { method: "POST", json: { name: "x", email: "nopass_" + ts + "@test.ru", phone: "78111111111" } });
    eq(r.status, 400, "status");
  })());
  await TA("register: short password → 400", (async () => {
    const r = await anon("/api/register", { method: "POST", json: { name: "x", email, phone, password: "123" } });
    eq(r.status, 400, "status");
  })());
  await TA("register: invalid phone → 400", (async () => {
    const r = await anon("/api/register", { method: "POST", json: { name: "x", email, phone: "abc", password: "123456" } });
    eq(r.status, 400, "status");
  })());
  await TA("register: success", (async () => {
    const r = await anon("/api/register", { method: "POST", json: { name: "Тест Тест", email, phone, password: "secret123" } });
    eq(r.status, 200, "status");
    ok(r.data.user && r.data.user.email === email, "user returned");
  })());
  await TA("register: duplicate email → 409", (async () => {
    const r = await anon("/api/register", { method: "POST", json: { name: "x", email, phone: "79111111111", password: "secret123" } });
    eq(r.status, 409, "status");
  })());

  await TA("login: wrong password → 401", (async () => {
    const r = await user("/api/login", { method: "POST", json: { email, password: "wrong" } });
    eq(r.status, 401, "status");
  })());
  await TA("login: success", (async () => {
    const r = await user("/api/login", { method: "POST", json: { email, password: "secret123" } });
    eq(r.status, 200, "status");
    ok(r.data.user, "user");
  })());
  await TA("GET /api/me (authed)", (async () => {
    const r = await user("/api/me");
    eq(r.status, 200, "status");
    ok(r.data.user && r.data.user.email === email, "user email");
  })());
  await TA("GET /api/my (authed)", (async () => {
    const r = await user("/api/my");
    eq(r.status, 200, "status");
    ok(Array.isArray(r.data), "array");
  })());

  // protected endpoints without auth
  await TA("GET /api/my (anon) → 401", (async () => { const r = await fresh()("/api/my"); eq(r.status, 401, "status"); })());
  await TA("GET /api/admin/payments (anon) → 401", (async () => { const r = await fresh()("/api/admin/payments"); eq(r.status, 401, "status"); })());

  // ===== 5. Password reset =====
  await TA("reset/send: unknown phone → 404", (async () => {
    const r = await anon("/api/reset/send", { method: "POST", json: { phone: "799" + String(ts).slice(-9) } });
    eq(r.status, 404, "status");
  })());
  const resetClient = makeClient();
  const rs = await resetClient("/api/reset/send", { method: "POST", json: { phone } });
  await T("reset/send: known phone → demoCode", () => {
    eq(rs.status, 200, "status");
    ok(rs.data.demoCode && /^\d{6}$/.test(rs.data.demoCode), "6-digit demo code");
  });
  await TA("reset/confirm: wrong code → 400", (async () => {
    const r = await resetClient("/api/reset/confirm", { method: "POST", json: { phone, code: "000000", newPassword: "newpass123" } });
    eq(r.status, 400, "status");
  })());
  await TA("reset/confirm: short password → 400", (async () => {
    const r = await resetClient("/api/reset/confirm", { method: "POST", json: { phone, code: rs.data.demoCode, newPassword: "123" } });
    eq(r.status, 400, "status");
  })());
  await TA("reset/confirm: success", (async () => {
    const r = await resetClient("/api/reset/confirm", { method: "POST", json: { phone, code: rs.data.demoCode, newPassword: "newpass123" } });
    eq(r.status, 200, "status");
    ok(r.data.success, "success");
  })());
  await TA("login with new password works", (async () => {
    const r = await anon("/api/login", { method: "POST", json: { email, password: "newpass123" } });
    eq(r.status, 200, "status");
  })());
  await TA("login with old password fails", (async () => {
    const r = await anon("/api/login", { method: "POST", json: { email, password: "secret123" } });
    eq(r.status, 401, "status");
  })());
  await TA("reset/confirm: reuse code → 400 (deleted)", (async () => {
    const r = await resetClient("/api/reset/confirm", { method: "POST", json: { phone, code: rs.data.demoCode, newPassword: "another123" } });
    eq(r.status, 400, "status");
  })());

  // ===== 6. Payment flow =====
  // find paid course; if none, create one via admin later. Use first paid course.
  const paid = courses.data.find(c => Number(c.price) > 0);
  const free = courses.data.find(c => Number(c.price) === 0);
  const paidId = paid ? paid.id : null;

  if (paidId) {
    await TA("sms-send (anon) → 401", (async () => {
      const r = await fresh()("/api/payment/sms-send", { method: "POST", json: { courseId: paidId, payment: { method: "qr" } } });
      eq(r.status, 401, "status");
    })());
    await TA("sms-send: no payment → 400", (async () => {
      const r = await user("/api/payment/sms-send", { method: "POST", json: { courseId: paidId } });
      eq(r.status, 400, "status");
    })());
    await TA("sms-send: unknown course → 404", (async () => {
      const r = await user("/api/payment/sms-send", { method: "POST", json: { courseId: 999999, payment: { method: "qr" } } });
      eq(r.status, 404, "status");
    })());
    const sms = await user("/api/payment/sms-send", { method: "POST", json: { courseId: paidId, payment: { method: "qr" } } });
    await T("sms-send: success → demoCode + QR", () => {
      eq(sms.status, 200, "status");
      ok(sms.data.demoCode && /^\d{6}$/.test(sms.data.demoCode), "code");
      ok(sms.data.qrImage && sms.data.qrImage.startsWith("data:image"), "qr image");
    });
    await TA("sms-confirm: wrong code → 400", (async () => {
      const r = await user("/api/payment/sms-confirm", { method: "POST", json: { courseId: paidId, code: "000000" } });
      eq(r.status, 400, "status");
    })());
    await TA("sms-confirm: success → enrolled", (async () => {
      const r = await user("/api/payment/sms-confirm", { method: "POST", json: { courseId: paidId, code: sms.data.demoCode } });
      eq(r.status, 200, "status");
      ok(r.data.paid === true, "paid");
      const my = await user("/api/my");
      ok(my.data.some(c => c.id === paidId), "course in my list");
      const pay = await user("/api/my/payments");
      ok(pay.data.some(p => p.course_id === paidId || p.course_title), "payment recorded");
    })());
    await TA("sms-confirm: second use of code → 400", (async () => {
      const r = await user("/api/payment/sms-confirm", { method: "POST", json: { courseId: paidId, code: sms.data.demoCode } });
      eq(r.status, 400, "status");
    })());
    await TA("sms-confirm: without send → 400", (async () => {
      const r = await user("/api/payment/sms-confirm", { method: "POST", json: { courseId: paidId, code: "123456" } });
      eq(r.status, 400, "status");
    })());
  }
  if (free) {
    await TA("sms-send free course → 400", (async () => {
      const r = await user("/api/payment/sms-send", { method: "POST", json: { courseId: free.id, payment: { method: "qr" } } });
      eq(r.status, 400, "status");
    })());
  }

  // ===== 7. Course content / progress =====
  if (courseId) {
    // pick a course the test user is NOT enrolled in
    const my = await user("/api/my");
    const enrolledIds = new Set(my.data.map(c => c.id));
    const nonEnrolled = courses.data.find(c => !enrolledIds.has(c.id));
    if (nonEnrolled) {
      const nc = await anon(`/api/courses/${nonEnrolled.id}`);
      await T("non-enrolled: lessons hide content", () => {
        const l = nc.data.lessons[0];
        ok(l && !("content" in l) && !("video_url" in l), "content hidden");
      });
      await TA("progress: anon → 401", (async () => {
        const r = await fresh()(`/api/courses/${nonEnrolled.id}/progress`, { method: "POST", json: { lessonId: nc.data.lessons[0].id } });
        eq(r.status, 401, "status");
      })());
      await TA("progress: logged-in not-enrolled → 403", (async () => {
        const r = await user(`/api/courses/${nonEnrolled.id}/progress`, { method: "POST", json: { lessonId: nc.data.lessons[0].id } });
        eq(r.status, 403, "status");
      })());
    }
  }

  // ===== 8. Orders (cart) =====
  await TA("order: anon → 401", (async () => {
    const r = await fresh()("/api/orders", { method: "POST", json: { name: "x", phone: "79111111111", items: [{ id: prodId, qty: 1 }] } });
    eq(r.status, 401, "status");
  })());
  await TA("order: missing name/phone → 400", (async () => {
    const r = await user("/api/orders", { method: "POST", json: { items: [{ id: prodId, qty: 1 }] } });
    eq(r.status, 400, "status");
  })());
  await TA("order: empty cart → 400", (async () => {
    const r = await user("/api/orders", { method: "POST", json: { name: "x", phone: "79111111111", items: [] } });
    eq(r.status, 400, "status");
  })());
  await TA("order: unknown product → 400", (async () => {
    const r = await user("/api/orders", { method: "POST", json: { name: "x", phone: "79111111111", items: [{ id: 999999, qty: 1 }] } });
    eq(r.status, 400, "status");
  })());
  if (prodId) {
    await TA("order: success", (async () => {
      const r = await user("/api/orders", { method: "POST", json: { name: "Покупатель", phone: "79111111111", address: "Москва", items: [{ id: prodId, qty: 2 }] } });
      eq(r.status, 200, "status");
      ok(r.data.orderId > 0, "orderId");
    })());
  }
  // out of stock product
  const outOfStock = products.data.find(p => !p.in_stock);
  if (outOfStock) {
    await TA("order: out of stock → 400", (async () => {
      const r = await user("/api/orders", { method: "POST", json: { name: "x", phone: "79111111111", items: [{ id: outOfStock.id, qty: 1 }] } });
      eq(r.status, 400, "status");
    })());
  }

  // ===== 9. Logout =====
  await TA("logout → 200", (async () => {
    const r = await user("/api/logout", { method: "POST" });
    eq(r.status, 200, "status");
  })());
  await TA("GET /api/my after logout → 401", (async () => {
    const r = await user("/api/my");
    eq(r.status, 401, "status");
  })());

  // ===== 10. Admin =====
  const alogin = await admin("/api/login", { method: "POST", json: { email: "admin@courses.ru", password: "admin123" } });
  await T("admin login → 200", () => eq(alogin.status, 200, "status"));
  if (alogin.status === 200) {
    const tests = [
      ["/api/categories", 200],
      ["/api/courses", 200],
      ["/api/admin/instructors", 200],
      ["/api/admin/payments", 200],
      ["/api/admin/users", 200],
      ["/api/admin/requests", 200],
      ["/api/admin/site-reviews", 200],
      ["/api/admin/products", 200],
      ["/api/admin/services", 200],
      ["/api/admin/consultations", 200],
    ];
    for (const [p, s] of tests) {
      await TA(`admin GET ${p} → ${s}`, (async () => { const r = await admin(p); eq(r.status, s, "status"); })());
    }
    // admin creates category (endpoint returns {success}, no id)
    const cname = "testcat_" + ts;
    await TA("admin create category", (async () => {
      const r = await admin("/api/admin/categories", { method: "POST", json: { name: cname } });
      eq(r.status, 200, "status");
      eq(r.data.success, true, "success");
      const list = await admin("/api/categories");
      const created = list.data.find(c => c.name === cname);
      ok(created, "category appears in list");
      const del = await admin(`/api/admin/categories/${created.id}`, { method: "DELETE" });
      eq(del.status, 200, "delete status");
    })());

    // ---- admin CRUD: courses + lessons + media ----
    let crudCourseId = null;
    await TA("admin create course", (async () => {
      const r = await admin("/api/admin/courses", { method: "POST", json: { title: "CRUD курс " + ts, description: "d", price: 0 } });
      eq(r.status, 200, "status");
      eq(r.data.success, true, "success");
      ok(r.data.id > 0, "id");
      crudCourseId = r.data.id;
      const upd = await admin(`/api/admin/courses/${crudCourseId}`, { method: "PUT", json: { title: "CRUD курс обновлён " + ts, price: 100 } });
      eq(upd.status, 200, "update status");
      const got = await anon(`/api/courses/${crudCourseId}`);
      eq(got.data.title, "CRUD курс обновлён " + ts, "updated title");
    })());
    await TA("admin course missing title → 400", (async () => {
      const r = await admin("/api/admin/courses", { method: "POST", json: { description: "x" } });
      eq(r.status, 400, "status");
    })());
    if (crudCourseId) {
      await TA("admin add lesson → success", (async () => {
        const r = await admin(`/api/admin/courses/${crudCourseId}/lessons`, { method: "POST", json: { title: "Урок CRUD", content: "<p>тест</p>", duration_min: 10 } });
        eq(r.status, 200, "status");
        eq(r.data.success, true, "success");
      })());
      await TA("admin add lesson missing title → 400", (async () => {
        const r = await admin(`/api/admin/courses/${crudCourseId}/lessons`, { method: "POST", json: { content: "x" } });
        eq(r.status, 400, "status");
      })());
      await TA("admin add media (video) → success+type", (async () => {
        const r = await admin(`/api/admin/courses/${crudCourseId}/media`, { method: "POST", json: { url: "https://example.com/lesson.mp4" } });
        eq(r.status, 200, "status");
        eq(r.data.type, "video", "type");
      })());
      await TA("admin add media missing url → 400", (async () => {
        const r = await admin(`/api/admin/courses/${crudCourseId}/media`, { method: "POST", json: {} });
        eq(r.status, 400, "status");
      })());
      const crudDetail = await admin(`/api/courses/${crudCourseId}`);
      const crudMed = crudDetail.data.media && crudDetail.data.media[0];
      if (crudMed) {
        await TA("admin delete media", (async () => {
          const r = await admin(`/api/admin/media/${crudMed.id}`, { method: "DELETE" });
          eq(r.status, 200, "status");
        })());
      }
      const crudLesson = crudDetail.data.lessons && crudDetail.data.lessons[0];
      if (crudLesson) {
        await TA("admin delete lesson", (async () => {
          const r = await admin(`/api/admin/lessons/${crudLesson.id}`, { method: "DELETE" });
          eq(r.status, 200, "status");
        })());
      }
      await TA("admin delete course", (async () => {
        const r = await admin(`/api/admin/courses/${crudCourseId}`, { method: "DELETE" });
        eq(r.status, 200, "status");
      })());
    }

    // ---- admin CRUD: instructors ----
    let crudInstId = null;
    await TA("admin create instructor", (async () => {
      const r = await admin("/api/admin/instructors", { method: "POST", json: { name: "Инструктор " + ts, specialty: "Тест", bio: "био", socials: { telegram: "@t", youtube: "https://youtu" } } });
      eq(r.status, 200, "status");
      ok(r.data.id > 0, "id");
      crudInstId = r.data.id;
    })());
    await TA("admin instructor missing name → 400", (async () => {
      const r = await admin("/api/admin/instructors", { method: "POST", json: { specialty: "x" } });
      eq(r.status, 400, "status");
    })());
    if (crudInstId) {
      await TA("public GET /api/instructors/:id", (async () => {
        const r = await anon(`/api/instructors/${crudInstId}`);
        eq(r.status, 200, "status");
        eq(r.data.name, "Инструктор " + ts, "name");
      })());
      await TA("admin update instructor", (async () => {
        const r = await admin(`/api/admin/instructors/${crudInstId}`, { method: "PUT", json: { name: "Инструктор 2 " + ts, specialty: "Тест2" } });
        eq(r.status, 200, "status");
      })());
      await TA("admin delete instructor", (async () => {
        const r = await admin(`/api/admin/instructors/${crudInstId}`, { method: "DELETE" });
        eq(r.status, 200, "status");
      })());
      await TA("public GET /api/instructors/:id → 404 after delete", (async () => {
        const r = await anon(`/api/instructors/${crudInstId}`);
        eq(r.status, 404, "status");
      })());
    }

    // ---- admin CRUD: products / services / consultations + images ----
    for (const it of ["product", "service", "consultation"]) {
      const body = it === "product" ? { name: "Товар " + ts }
        : it === "service" ? { name: "Услуга " + ts, duration_min: 30, icon: "x" }
        : { title: "Консультация " + ts, duration_min: 30, expert: "Эксперт" };
      let itemId = null;
      await TA(`admin create ${it} → success+id`, (async () => {
        const r = await admin(`/api/admin/${it}s`, { method: "POST", json: body });
        eq(r.status, 200, "status");
        ok(r.data.id > 0, "id");
        itemId = r.data.id;
      })());
      if (itemId) {
        await TA(`admin create ${it} missing name → 400`, (async () => {
          const r = await admin(`/api/admin/${it}s`, { method: "POST", json: {} });
          eq(r.status, 400, "status");
        })());
        await TA(`admin update ${it}`, (async () => {
          const r = await admin(`/api/admin/${it}s/${itemId}`, { method: "PUT", json: { ...body, price: 99 } });
          eq(r.status, 200, "status");
        })());
        await TA(`admin add image to ${it}`, (async () => {
          const r = await admin(`/api/admin/${it}s/${itemId}/images`, { method: "POST", json: { url: "https://example.com/img.png" } });
          eq(r.status, 200, "status");
        })());
        await TA(`admin add image missing url → 400`, (async () => {
          const r = await admin(`/api/admin/${it}s/${itemId}/images`, { method: "POST", json: {} });
          eq(r.status, 400, "status");
        })());
        await TA(`public GET /api/items/${it}/:id shows image`, (async () => {
          const r = await anon(`/api/items/${it}/${itemId}`);
          eq(r.status, 200, "status");
          ok(r.data.images && r.data.images.includes("https://example.com/img.png"), "image listed");
        })());
        const admRecs = await admin(`/api/admin/${it}s`);
        const rec = admRecs.data.find(x => x.id === itemId);
        if (rec && rec.images && rec.images.length) {
          await TA("admin delete item image", (async () => {
            const r = await admin(`/api/admin/item-images/${rec.images[0].id}`, { method: "DELETE" });
            eq(r.status, 200, "status");
          })());
        }
        await TA(`admin delete ${it}`, (async () => {
          const r = await admin(`/api/admin/${it}s/${itemId}`, { method: "DELETE" });
          eq(r.status, 200, "status");
        })());
        await TA(`public GET /api/items/${it}/:id → 404 after delete`, (async () => {
          const r = await anon(`/api/items/${it}/${itemId}`);
          eq(r.status, 404, "status");
        })());
      }
    }

    // ---- admin CRUD: users ----
    const newUserEmail = `adminuser_${ts}@test.ru`;
    let newUserId = null;
    await TA("admin create user", (async () => {
      const r = await admin("/api/admin/users", { method: "POST", json: { name: "АдминСоздал", email: newUserEmail, password: "secret123", role: "user" } });
      eq(r.status, 200, "status");
      ok(r.data.id > 0, "id");
      newUserId = r.data.id;
    })());
    await TA("admin create user missing fields → 400", (async () => {
      const r = await admin("/api/admin/users", { method: "POST", json: { name: "x" } });
      eq(r.status, 400, "status");
    })());
    await TA("admin create user duplicate email → 409", (async () => {
      const r = await admin("/api/admin/users", { method: "POST", json: { name: "x", email: newUserEmail, password: "secret123" } });
      eq(r.status, 409, "status");
    })());
    if (newUserId) {
      await TA("admin change role to admin", (async () => {
        const r = await admin(`/api/admin/users/${newUserId}/role`, { method: "POST", json: { role: "admin" } });
        eq(r.status, 200, "status");
      })());
      await TA("admin change role invalid → 400", (async () => {
        const r = await admin(`/api/admin/users/${newUserId}/role`, { method: "POST", json: { role: "superadmin" } });
        eq(r.status, 400, "status");
      })());
      const someCourseId = paidId || courseId;
      if (someCourseId) {
        await TA("admin enroll user to course", (async () => {
          const r = await admin(`/api/admin/users/${newUserId}/courses`, { method: "POST", json: { courseId: someCourseId } });
          eq(r.status, 200, "status");
        })());
        await TA("admin enroll user unknown course → 404", (async () => {
          const r = await admin(`/api/admin/users/${newUserId}/courses`, { method: "POST", json: { courseId: 999999 } });
          eq(r.status, 404, "status");
        })());
        await TA("admin users list shows enrolled course", (async () => {
          const r = await admin("/api/admin/users");
          const u = r.data.find(x => x.id === newUserId);
          ok(u && u.courses && u.courses.some(c => c.id === someCourseId), "course listed");
        })());
        await TA("admin unenroll user", (async () => {
          const r = await admin(`/api/admin/users/${newUserId}/courses/${someCourseId}`, { method: "DELETE" });
          eq(r.status, 200, "status");
        })());
      }
      await TA("admin delete user", (async () => {
        const r = await admin(`/api/admin/users/${newUserId}`, { method: "DELETE" });
        eq(r.status, 200, "status");
      })());
    }
    await TA("admin cannot delete self → 400", (async () => {
      const list = await admin("/api/admin/users");
      const me = list.data.find(u => u.role === "admin");
      const r = await admin(`/api/admin/users/${me.id}`, { method: "DELETE" });
      eq(r.status, 400, "status");
    })());
    await TA("admin cannot demote last admin → 400", (async () => {
      const list = await admin("/api/admin/users");
      const me = list.data.find(u => u.role === "admin");
      const r = await admin(`/api/admin/users/${me.id}/role`, { method: "POST", json: { role: "user" } });
      eq(r.status, 400, "status");
    })());

    // ---- admin CRUD: site reviews ----
    let reviewId = null;
    await TA("admin create site review", (async () => {
      const r = await admin("/api/admin/site-reviews", { method: "POST", json: { author: "Тест " + ts, rating: 5, text: "Отличный сайт" } });
      eq(r.status, 200, "status");
      ok(r.data.id > 0, "id");
      reviewId = r.data.id;
    })());
    await TA("admin site review missing text → 400", (async () => {
      const r = await admin("/api/admin/site-reviews", { method: "POST", json: { author: "x" } });
      eq(r.status, 400, "status");
    })());
    await TA("public /api/site-reviews includes new", (async () => {
      const r = await anon("/api/site-reviews");
      ok(r.data.some(s => s.id === reviewId), "listed");
    })());
    if (reviewId) {
      await TA("admin delete site review", (async () => {
        const r = await admin(`/api/admin/site-reviews/${reviewId}`, { method: "DELETE" });
        eq(r.status, 200, "status");
      })());
    }

    // non-admin cannot call admin API
    const u2 = makeClient();
    await u2("/api/login", { method: "POST", json: { email, password: "newpass123" } });
    await TA("non-admin GET /api/admin/payments → 403", (async () => {
      const r = await u2("/api/admin/payments");
      eq(r.status, 403, "status");
    })());
    // regular user hits admin pages — page loads but shows denied; API is guarded
  }

  // ===== 11. Consultation request =====
  await TA("consultation request: anon → 401", (async () => {
    const r = await fresh()("/api/consultations/request", { method: "POST", json: { name: "x", phone: "79111111111" } });
    eq(r.status, 401, "status");
  })());
  const u3 = makeClient();
  await u3("/api/login", { method: "POST", json: { email, password: "newpass123" } });
  await TA("consultation request: success", (async () => {
    const r = await u3("/api/consultations/request", { method: "POST", json: { name: "x", phone: "79111111111" } });
    eq(r.status, 200, "status");
  })());
  await TA("consultation request: missing phone → 400", (async () => {
    const r = await u3("/api/consultations/request", { method: "POST", json: { name: "x" } });
    eq(r.status, 400, "status");
  })());

  // ===== 12. Full flows: enroll, reviews, certificate, uploads, media =====
  // re-login the test user (was logged out in section 9)
  await TA("login user again for flow tests", (async () => {
    const r = await user("/api/login", { method: "POST", json: { email, password: "newpass123" } });
    eq(r.status, 200, "status");
  })());
  // a second registered user that is NOT enrolled anywhere
  const plainEmail = `plain_${ts}@test.ru`;
  await anon("/api/register", { method: "POST", json: { name: "Простой Юзер", email: plainEmail, phone: "79122222222", password: "plain12345" } });
  const plain = makeClient();
  await TA("login plain user", (async () => {
    const r = await plain("/api/login", { method: "POST", json: { email: plainEmail, password: "plain12345" } });
    eq(r.status, 200, "status");
  })());

  // ---- item review (on a throwaway product so re-runs stay clean) ----
  if (alogin.status === 200) {
    let reviewProdId = null;
    await TA("admin create product for review test", (async () => {
      const r = await admin("/api/admin/products", { method: "POST", json: { name: "Отзыв-товар " + ts } });
      eq(r.status, 200, "status");
      reviewProdId = r.data.id;
    })());
    if (reviewProdId) {
      await TA("item review: anon → 401", (async () => {
        const r = await fresh()(`/api/items/product/${reviewProdId}/review`, { method: "POST", json: { rating: 5, comment: "ok" } });
        eq(r.status, 401, "status");
      })());
      await TA("item review: success", (async () => {
        const r = await user(`/api/items/product/${reviewProdId}/review`, { method: "POST", json: { rating: 5, comment: "Хороший товар " + ts } });
        eq(r.status, 200, "status");
      })());
      await TA("item review: duplicate → 400", (async () => {
        const r = await user(`/api/items/product/${reviewProdId}/review`, { method: "POST", json: { rating: 4, comment: "повтор" } });
        eq(r.status, 400, "status");
      })());
      await TA("item review: missing comment → 400", (async () => {
        const r = await user(`/api/items/product/${reviewProdId}/review`, { method: "POST", json: { rating: 5 } });
        eq(r.status, 400, "status");
      })());
      await TA("item review visible on item page", (async () => {
        const r = await anon(`/api/items/product/${reviewProdId}`);
        ok(r.data.reviews.some(x => x.comment === "Хороший товар " + ts), "review listed");
      })());
      await TA("admin delete review product", (async () => {
        const r = await admin(`/api/admin/products/${reviewProdId}`, { method: "DELETE" });
        eq(r.status, 200, "status");
      })());
    }
  }

  // ---- enroll endpoint ----
  if (courseId) {
    await TA("enroll: anon → 401", (async () => {
      const r = await fresh()(`/api/courses/${courseId}/enroll`, { method: "POST" });
      eq(r.status, 401, "status");
    })());
  }
  if (paidId) {
    await TA("enroll: paid course → 400", (async () => {
      const r = await user(`/api/courses/${paidId}/enroll`, { method: "POST" });
      eq(r.status, 400, "status");
    })());
  }
  if (free) {
    await TA("enroll: free course → success", (async () => {
      const r = await user(`/api/courses/${free.id}/enroll`, { method: "POST" });
      eq(r.status, 200, "status");
      eq(r.data.paid, false, "paid false");
    })());
  }

  // ---- certificate + course review on a dedicated flow course ----
  let flowCourseId = null, flowLessonId = null;
  if (alogin.status === 200) {
    await TA("admin create flow course", (async () => {
      const r = await admin("/api/admin/courses", { method: "POST", json: { title: "Flow курс " + ts, description: "Для полного сценария", price: 0 } });
      eq(r.status, 200, "status");
      flowCourseId = r.data.id;
    })());
    if (flowCourseId) {
      await TA("admin add flow lesson with quiz", (async () => {
        const r = await admin(`/api/admin/courses/${flowCourseId}/lessons`, { method: "POST", json: {
          title: "Урок 1", content: "<p>Содержимое</p>", duration_min: 15,
          quiz: JSON.stringify([{ q: "Вопрос?", options: ["А", "Б", "В"], correct: 1 }])
        } });
        eq(r.status, 200, "status");
      })());
      const fc = await admin(`/api/courses/${flowCourseId}`);
      flowLessonId = fc.data.lessons && fc.data.lessons[0] ? fc.data.lessons[0].id : null;
      await T("admin sees parsed quiz in lessons", () => {
        ok(fc.data.lessons[0] && fc.data.lessons[0].quiz && fc.data.lessons[0].quiz.length === 1, "quiz parsed");
        eq(fc.data.lessons[0].quiz[0].options.length, 3, "options");
      });
      await TA("certificate: not enrolled → 403", (async () => {
        const r = await user(`/api/certificate/${flowCourseId}`);
        eq(r.status, 403, "status");
      })());
      await TA("admin enroll user to flow course", (async () => {
        const list = await admin("/api/admin/users");
        const me = list.data.find(u => u.email === email);
        const r = await admin(`/api/admin/users/${me.id}/courses`, { method: "POST", json: { courseId: flowCourseId } });
        eq(r.status, 200, "status");
      })());
      await TA("course review: success (enrolled)", (async () => {
        const r = await user(`/api/courses/${flowCourseId}/review`, { method: "POST", json: { rating: 5, comment: "Отличный курс " + ts } });
        eq(r.status, 200, "status");
      })());
      await TA("course review: non-enrolled → 403", (async () => {
        const r = await plain(`/api/courses/${flowCourseId}/review`, { method: "POST", json: { rating: 5, comment: "нет доступа" } });
        eq(r.status, 403, "status");
      })());
      await TA("course review: anon → 401", (async () => {
        const r = await fresh()(`/api/courses/${flowCourseId}/review`, { method: "POST", json: { rating: 5, comment: "нет" } });
        eq(r.status, 401, "status");
      })());
      await TA("course review visible on course page", (async () => {
        const r = await anon(`/api/courses/${flowCourseId}`);
        ok(r.data.reviews.some(x => x.comment === "Отличный курс " + ts), "review listed");
      })());
      if (flowLessonId) {
        await TA("progress: enrolled → 100", (async () => {
          const r = await user(`/api/courses/${flowCourseId}/progress`, { method: "POST", json: { lessonId: flowLessonId } });
          eq(r.status, 200, "status");
          eq(r.data.progress, 100, "progress 100");
        })());
        await TA("progress: unknown lesson → 404", (async () => {
          const r = await user(`/api/courses/${flowCourseId}/progress`, { method: "POST", json: { lessonId: 999999 } });
          eq(r.status, 404, "status");
        })());
        await TA("certificate: completed → PDF", (async () => {
          const res = await user.raw(`/api/certificate/${flowCourseId}`);
          eq(res.status, 200, "status");
          const ct = res.headers.get("content-type") || "";
          ok(ct.includes("application/pdf"), "pdf content-type: " + ct);
          const buf = Buffer.from(await res.arrayBuffer());
          ok(buf.length > 5000, "pdf size " + buf.length);
          ok(buf.slice(0, 4).toString() === "%PDF", "PDF magic");
        })());
      }
    }
  }

  // ---- uploads + protected media ----
  const imgPng = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52]);
  const videoMp4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6D, 0x70, 0x34]);
  let imgUrl = null, videoUrl = null;
  if (alogin.status === 200) {
    await TA("upload image (admin) → url", (async () => {
      const fd = new FormData();
      fd.append("file", new Blob([imgPng], { type: "image/png" }), "test.png");
      const res = await admin.raw("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      eq(res.status, 200, "status");
      ok(data.url && /^\/api\/media\//.test(data.url), "media url");
      imgUrl = data.url;
    })());
    await TA("upload video (admin) → url", (async () => {
      const fd = new FormData();
      fd.append("file", new Blob([videoMp4], { type: "video/mp4" }), "test.mp4");
      const res = await admin.raw("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      eq(res.status, 200, "status");
      ok(data.url && /^\/api\/media\//.test(data.url), "media url");
      videoUrl = data.url;
    })());
    await TA("upload invalid type → 400", (async () => {
      const fd = new FormData();
      fd.append("file", new Blob([Buffer.from("x")], { type: "text/plain" }), "a.js");
      const res = await admin.raw("/api/upload", { method: "POST", body: fd });
      eq(res.status, 400, "status");
    })());
    await TA("upload svg rejected → 400", (async () => {
      const fd = new FormData();
      fd.append("file", new Blob([Buffer.from("<svg/>")], { type: "image/svg+xml" }), "a.svg");
      const res = await admin.raw("/api/upload", { method: "POST", body: fd });
      eq(res.status, 400, "status");
    })());
  }
  await TA("upload (anon) → 401", (async () => {
    const fd = new FormData();
    fd.append("file", new Blob([imgPng], { type: "image/png" }), "a.png");
    const res = await fresh().raw("/api/upload", { method: "POST", body: fd });
    eq(res.status, 401, "status");
  })());
  if (imgUrl) {
    await TA("GET /api/media/:file (image, public) → 200", (async () => {
      const r = await fresh()(imgUrl);
      eq(r.status, 200, "status");
    })());
    await TA("GET /uploads/:file → redirect", (async () => {
      const res = await fresh().raw("/uploads/" + imgUrl.split("/").pop());
      ok([301, 302].includes(res.status), "redirect status " + res.status);
    })());
  }
  await TA("GET /api/media/missing.png → 404", (async () => {
    const r = await fresh()("/api/media/__missing__.png");
    eq(r.status, 404, "status");
  })());
  if (videoUrl) {
    await TA("GET video media: anon → 401", (async () => {
      const r = await fresh()(videoUrl);
      eq(r.status, 401, "status");
    })());
    await TA("GET video media: non-enrolled → 403", (async () => {
      const r = await plain(videoUrl);
      eq(r.status, 403, "status");
    })());
    await TA("GET video media: admin → 200", (async () => {
      const r = await admin(videoUrl);
      eq(r.status, 200, "status");
    })());
    if (flowCourseId) {
      await TA("admin attach video to course media", (async () => {
        const r = await admin(`/api/admin/courses/${flowCourseId}/media`, { method: "POST", json: { url: videoUrl } });
        eq(r.status, 200, "status");
      })());
      await TA("GET video media: enrolled → 200", (async () => {
        const r = await user(videoUrl);
        eq(r.status, 200, "status");
      })());
    }
  }

  // ---- cleanup of flow course ----
  if (flowCourseId) {
    await TA("cleanup: unenroll user", (async () => {
      const list = await admin("/api/admin/users");
      const me = list.data.find(u => u.email === email);
      const r = await admin(`/api/admin/users/${me.id}/courses/${flowCourseId}`, { method: "DELETE" });
      eq(r.status, 200, "status");
    })());
    if (flowLessonId) {
      await TA("cleanup: delete flow lesson", (async () => {
        const r = await admin(`/api/admin/lessons/${flowLessonId}`, { method: "DELETE" });
        eq(r.status, 200, "status");
      })());
    }
    await TA("cleanup: delete flow course", (async () => {
      const r = await admin(`/api/admin/courses/${flowCourseId}`, { method: "DELETE" });
      eq(r.status, 200, "status");
    })());
  }

  // ---- admin: delete payment / request ----
  await TA("admin delete payment", (async () => {
    const list = await admin("/api/admin/payments");
    const p = list.data[0];
    ok(p, "at least one payment exists");
    const r = await admin(`/api/admin/payments/${p.id}`, { method: "DELETE" });
    eq(r.status, 200, "status");
  })());
  await TA("admin delete request", (async () => {
    const list = await admin("/api/admin/requests");
    const p = list.data[0];
    ok(p, "at least one request exists");
    const r = await admin(`/api/admin/requests/${p.id}`, { method: "DELETE" });
    eq(r.status, 200, "status");
  })());

  // ===== 13. Security hardening =====
  await TA("security headers on pages", (async () => {
    const res = await fresh().raw("/");
    const h = res.headers;
    ok(h.get("x-content-type-options") === "nosniff", "nosniff");
    ok(h.get("x-frame-options") === "DENY", "frame deny");
    ok((h.get("content-security-policy") || "").includes("default-src 'self'"), "csp present");
    ok((h.get("referrer-policy") || "").length > 0, "referrer policy");
  })());
  await TA("session cookie is HttpOnly + SameSite=Lax", (async () => {
    const c = makeClient();
    const cookieEmail = "cookie_" + ts + "@test.ru";
    await c("/api/register", { method: "POST", json: { name: "Куки Тест", email: cookieEmail, phone: "79133333333", password: "secret123" } });
    const loginRes = await c.raw("/api/login", { method: "POST", json: { email: cookieEmail, password: "secret123" } });
    const sc = (loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get("set-cookie") || ""]).join("; ");
    ok(/HttpOnly/i.test(sc), "HttpOnly flag");
    ok(/SameSite=Lax/i.test(sc), "SameSite=Lax");
  })());
  await TA("rate limit reset/confirm → 429", (async () => {
    const c = makeClient();
    const hammerPhone = "7999" + String(ts % 100000000).padStart(8, "0");
    let got429 = false, blockedAfterThreshold = false;
    for (let i = 0; i < 12; i++) {
      const r = await c("/api/reset/confirm", { method: "POST", json: { phone: hammerPhone, code: "000000", newPassword: "x123456" } });
      if (r.status === 429) {
        got429 = true;
        if (i >= 10) blockedAfterThreshold = true;
      }
    }
    ok(got429, "got 429 after threshold");
    ok(blockedAfterThreshold, "429 only after ~10 attempts");
  })());

  // ===== Report =====
  console.log("\n=====================================");
  console.log(`PASSED: ${passed}  FAILED: ${failed}`);
  console.log("=====================================");
  if (failures.length) {
    console.log("\nFAILURES:");
    failures.forEach(f => console.log("  ✗ " + f));
    process.exit(1);
  } else {
    console.log("ALL TESTS PASSED");
  }
})().catch(e => { console.error("SCRIPT ERROR:", e); process.exit(2); });
