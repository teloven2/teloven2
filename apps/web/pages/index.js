<a href="/register">Registrar</a> | <a href="/login">Login</a>
import React, { useState } from "react";

export default function Home() {
  const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

  const [email, setEmail] = useState("buyer@test.com");
  const [password, setPassword] = useState("password123");
  const [name, setName] = useState("Buyer Demo");
  const [token, setToken] = useState("");

  const [listingId, setListingId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [initPoint, setInitPoint] = useState("");

  async function register() {
    const r = await fetch(`${API}/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    const j = await r.json();
    alert(j.message || "Revisa tu correo para verificar.");
  }

  async function resendVerification() {
  const r = await fetch(`${API}/v1/auth/resend-verification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const j = await r.json();
  alert(j.message || "Listo.");
}

async function login() {
    const r = await fetch(`${API}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const j = await r.json();
    if (j.token) setToken(j.token);
    else alert(j?.error?.message || "No se pudo iniciar sesión");
  }

  async function createDemoListing() {
    const r = await fetch(`${API}/v1/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        type: "product",
        title: "Demo: Producto Teloven2",
        description: "Este es un listing de prueba",
        price: 1000,
        currency: "CLP",
      }),
    });
    const j = await r.json();
    setListingId(j.listing?.id || "");
  }

  async function createOrder() {
    const r = await fetch(`${API}/v1/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ listingId }),
    });
    const j = await r.json();
    setOrderId(j.order?.id || "");
  }

  async function checkout() {
    const r = await fetch(`${API}/v1/orders/${orderId}/checkout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json();
    setInitPoint(j.initPoint || "");
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 820, margin: "0 auto" }}>
      <h1>Teloven2 (MVP)</h1>
      <p><b>Vende seguro. Cobra seguro. Compra tranquilo.</b></p>

      <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginTop: 16 }}>
        <h2>Auth (email-only)</h2>
        <p style={{ marginTop: 0 }}>1) Regístrate → 2) Verifica tu email → 3) Inicia sesión.</p>

        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
          <label>Email<br/><input value={email} onChange={e=>setEmail(e.target.value)} style={{ width: "100%" }} /></label>
          <label>Nombre<br/><input value={name} onChange={e=>setName(e.target.value)} style={{ width: "100%" }} /></label>
          <label>Contraseña<br/><input value={password} type="password" onChange={e=>setPassword(e.target.value)} style={{ width: "100%" }} /></label>
          <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
            <button onClick={register}>Registrarme</button>
            <button onClick={login}>Login</button>
            <button onClick={resendVerification}>Reenviar verificación</button>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 14 }}>
          <div><b>token:</b> {token ? "ok" : "-"}</div>
        </div>
      </section>

      <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginTop: 16 }}>
        <h2>Demo pago (requiere token + email verificado)</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={createDemoListing} disabled={!token}>1) Crear listing</button>
          <button onClick={createOrder} disabled={!listingId || !token}>2) Crear orden</button>
          <button onClick={checkout} disabled={!orderId || !token}>3) Checkout</button>
          {initPoint ? (
            <a href={initPoint} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>
              Ir a pagar (Mercado Pago)
            </a>
          ) : null}
        </div>

        <div style={{ marginTop: 12, fontSize: 14 }}>
          <div><b>listingId:</b> {listingId || "-"}</div>
          <div><b>orderId:</b> {orderId || "-"}</div>
        </div>
      </section>
    </main>
  );
}
