import React, { useState } from "react";
import { SafeAreaView, Text, View, TextInput, Pressable, Linking, ScrollView, Alert } from "react-native";

// ⚠️ Para probar en dispositivo real, cambia a tu IP local o URL pública
const API = "http://localhost:4000";

export default function App() {
  const [email, setEmail] = useState("buyer@test.com");
  const [password, setPassword] = useState("password123");
  const [name, setName] = useState("Buyer Demo");
  const [token, setToken] = useState("");

  const [listingId, setListingId] = useState("");
  const [orderId, setOrderId] = useState("");

  async function register() {
    const r = await fetch(`${API}/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    const j = await r.json();
    Alert.alert("Registro", j.message || "Revisa tu correo para verificar.");
  }

  async function resendVerification() {
  const r = await fetch(`${API}/v1/auth/resend-verification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const j = await r.json();
  Alert.alert("Verificación", j.message || "Listo.");
}

async function login() {
    const r = await fetch(`${API}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const j = await r.json();
    if (j.token) setToken(j.token);
    else Alert.alert("Login", j?.error?.message || "No se pudo iniciar sesión");
  }

  async function createListing() {
    const r = await fetch(`${API}/v1/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        type: "product",
        title: "Demo: Producto Teloven2 (App)",
        description: "Listing de prueba desde Expo",
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
    if (j.initPoint) Linking.openURL(j.initPoint);
    else Alert.alert("Checkout", j?.error?.message || "No se pudo crear checkout");
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Text style={{ fontSize: 28, fontWeight: "700" }}>Teloven2 (MVP)</Text>
        <Text style={{ fontSize: 16 }}>Vende seguro. Cobra seguro. Compra tranquilo.</Text>

        <View style={{ padding: 14, borderWidth: 1, borderRadius: 12, gap: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: "600" }}>Auth (email-only)</Text>
          <Text>Email</Text>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" style={{ borderWidth: 1, borderRadius: 10, padding: 10 }} />
          <Text>Nombre</Text>
          <TextInput value={name} onChangeText={setName} style={{ borderWidth: 1, borderRadius: 10, padding: 10 }} />
          <Text>Contraseña</Text>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry style={{ borderWidth: 1, borderRadius: 10, padding: 10 }} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable onPress={register} style={{ padding: 12, borderWidth: 1, borderRadius: 10 }}><Text>Registrarme</Text></Pressable>
            <Pressable onPress={login} style={{ padding: 12, borderWidth: 1, borderRadius: 10 }}><Text>Login</Text></Pressable>
            <Pressable onPress={resendVerification} style={{ padding: 12, borderWidth: 1, borderRadius: 10 }}><Text>Reenviar verificación</Text></Pressable>
          </View>
          <Text>token: {token ? "ok" : "-"}</Text>
          <Text style={{ color: "#6B7280" }}>Debes verificar tu email antes de poder crear listings/órdenes.</Text>
        </View>

        <View style={{ padding: 14, borderWidth: 1, borderRadius: 12, gap: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: "600" }}>Demo pago</Text>
          <Pressable onPress={createListing} disabled={!token} style={{ padding: 12, borderWidth: 1, borderRadius: 10, opacity: token ? 1 : 0.4 }}><Text>1) Crear listing</Text></Pressable>
          <Pressable onPress={createOrder} disabled={!listingId || !token} style={{ padding: 12, borderWidth: 1, borderRadius: 10, opacity: listingId && token ? 1 : 0.4 }}><Text>2) Crear orden</Text></Pressable>
          <Pressable onPress={checkout} disabled={!orderId || !token} style={{ padding: 12, borderWidth: 1, borderRadius: 10, opacity: orderId && token ? 1 : 0.4 }}><Text>3) Pagar con Mercado Pago</Text></Pressable>
          <Text>listingId: {listingId || "-"}</Text>
          <Text>orderId: {orderId || "-"}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
