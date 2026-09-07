// Trage hier deine eigenen Supabase-Zugangsdaten ein.
// Zu finden in deinem Supabase-Projekt unter: Project Settings -> API
//   - "Project URL"      -> SUPABASE_URL
//   - "anon public" Key  -> SUPABASE_ANON_KEY
//
// Der "anon" Key ist bewusst öffentlich/clientseitig sichtbar (das ist bei Supabase so
// vorgesehen) - der eigentliche Schutz kommt durch die Row-Level-Security-Regeln aus
// supabase-schema.sql, NICHT durch Geheimhaltung dieses Keys.
//
// Lässt du beide Werte auf "" (leer), läuft die App ohne Konten rein lokal weiter
// (wie bisher) - dann synchronisiert nichts zwischen Geräten.

window.SUPABASE_CONFIG = {
  url: "",       // z. B. "https://abcdefgh.supabase.co"
  anonKey: "",   // z. B. "eyJhbGciOi..."
};
