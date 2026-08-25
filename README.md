# Arbeitszeit Tracker

Eine kleine, installierbare Web-App (PWA) zum Erfassen von Arbeitszeit, Aufteilen auf
Kostenstellen/Kunden sowie unabhängig davon auf Laborzeit, und zum Export als Excel-Datei.

## Wichtig zuerst: Hosting nötig

Damit du die App als Icon aufs Handy speichern kannst (und damit sie offline funktioniert),
muss sie über **https** erreichbar sein – ein einfaches Doppelklicken der `index.html`
reicht für die volle "Installieren"-Funktion leider nicht aus. Die einfachsten kostenlosen
Optionen:

### Option A – Netlify Drop (schnellster Weg, kein Account nötig)

1. Öffne https://app.netlify.com/drop im Browser.
2. Ziehe den kompletten Ordner `arbeitszeit-tracker` (mit allen Dateien) per Drag & Drop
   auf die Seite.
3. Du bekommst sofort eine Adresse wie `https://irgendwas-1234.netlify.app`.
4. Diese Adresse auf dem Handy öffnen (siehe unten "Installation am Handy").

*Hinweis:* Bei der kostenlosen Drop-Nutzung ohne Account ist der Link öffentlich, aber
praktisch nicht auffindbar (zufällige Adresse). Für dauerhaften Zugriff empfiehlt sich ein
kostenloser Netlify- oder GitHub-Account.

### Option B – GitHub Pages (dauerhaft, mit Account)

1. Erstelle ein neues, privates oder öffentliches GitHub-Repository.
2. Lade alle Dateien aus diesem Ordner in das Repository hoch (z. B. per
   "Add file → Upload files" im Browser).
3. Gehe zu **Settings → Pages**, wähle als Quelle den `main`-Branch und Ordner `/ (root)`.
4. Nach ein bis zwei Minuten ist die App unter
   `https://DEIN-BENUTZERNAME.github.io/DEIN-REPO-NAME/` erreichbar.

## Installation am Handy

**iPhone (Safari):**
Seite öffnen → Teilen-Symbol (Quadrat mit Pfeil) → "Zum Home-Bildschirm" → Hinzufügen.

**Android (Chrome):**
Seite öffnen → Menü (drei Punkte) → "App installieren" bzw. "Zum Startbildschirm
hinzufügen".

## Nutzung am Computer

In Chrome oder Edge erscheint in der Adressleiste ein Installieren-Symbol – damit läuft
die App auch am Rechner als eigenständiges Fenster.

## Mehrere Geräte & Kolleg:innen (optional, mit Supabase)

Standardmäßig läuft die App **rein lokal** (siehe unten) – jedes Gerät hat seine eigenen
Daten, nichts synchronisiert automatisch. Wenn du **eigenes Konto = automatisch auf allen
deinen Geräten synchron**, aber **Kolleg:innen sehen sich gegenseitig nicht**, willst,
richte Supabase ein (kostenloser Tarif reicht für diesen Zweck locker):

1. Supabase-Projekt anlegen (falls noch nicht geschehen) auf https://supabase.com.
2. Im Supabase-Dashboard: **SQL Editor** öffnen, den Inhalt von `supabase-schema.sql`
   (liegt in diesem Ordner) einfügen und ausführen. Das legt die Tabellen, die
   Row-Level-Security-Regeln (jede:r sieht nur die eigenen Daten) und Realtime an.

   *Falls du das Schema schon früher einmal ausgeführt hast:* Bitte trotzdem erneut
   ausführen – die Datei wurde um die Profil-Spalten (Vorname, Nachname, Wochenstunden,
   Urlaubstage) erweitert. Das Skript ist so geschrieben, dass es gefahrlos beliebig oft
   ausgeführt werden kann: Es löscht keine Daten und überspringt alles bereits Vorhandene.
3. Unter **Project Settings → API** die **Project URL** und den **anon public**-Key
   kopieren.
4. Diese beiden Werte in `config.js` eintragen (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) –
   Anleitung steht direkt als Kommentar in der Datei.
5. Alle Dateien (inkl. der ausgefüllten `config.js`) hochladen/hosten wie gewohnt.

Danach zeigt die App beim ersten Öffnen einen Anmelde-Bildschirm (E-Mail + Passwort).
Jede Person – du und deine Kolleg:innen – registriert sich einmal mit der eigenen
E-Mail-Adresse. Meldet sich dieselbe Person auf einem zweiten Gerät mit demselben Konto
an, werden Einträge, Kostenstellen und Projekte automatisch abgeglichen (auch der
laufende Timer). Verschiedene Konten sehen sich dabei nie gegenseitig – das übernimmt die
Datenbank selbst (Row Level Security), unabhängig davon, wie die App programmiert ist.

**Angemeldet bleiben:** Nach dem ersten Login auf einem Gerät bleibt die Anmeldung dauerhaft
bestehen – die App fragt nicht bei jedem Öffnen erneut nach dem Passwort. Die Sitzung wird
im Hintergrund automatisch verlängert.

**Abmelden:** Oben rechts in der App auf das 👤-Symbol tippen → dort stehen die angemeldete
E-Mail-Adresse, der Sync-Status und der Button **„Abmelden"**. Sinnvoll z. B. an einem
gemeinsam genutzten Rechner oder wenn ein:e Kolleg:in kurz das eigene Konto verwenden will.

*Hinweis:* Standardmäßig verlangt Supabase eine Bestätigung der E-Mail-Adresse nach der
Registrierung (Link in einer automatisch verschickten Mail). Falls das für euren
internen Gebrauch unnötig ist, kannst du das unter **Authentication → Providers → Email**
in Supabase abschalten ("Confirm email" deaktivieren).

Lässt du `config.js` leer, läuft die App exakt wie zuvor rein lokal – der Login-Bildschirm
erscheint dann gar nicht erst.

## Wichtiger Hinweis zu den Daten

**Ohne Supabase-Einrichtung** (siehe oben) werden alle Einträge und Kostenstellen **lokal
im Browser des jeweiligen Geräts** gespeichert (nicht in einer Cloud, nicht
synchronisiert zwischen Handy und Rechner). Das heißt:

- Lösche nicht die Browserdaten/den Cache dieser Seite, sonst gehen Einträge verloren.
- Wenn du auf mehreren Geräten arbeitest, nutze im Tab **Export** den Button
  **"Backup exportieren (.json)"** regelmäßig, und importiere die Datei bei Bedarf auf dem
  anderen Gerät über **"Backup importieren (.json)"**.
- Die eigentliche Abrechnungs-Excel-Datei erzeugst du jederzeit über **"Excel-Datei
  erstellen"** – sie enthält alle bis dahin erfassten Einträge.

## Kurzanleitung zur App

1. **Timer:** "Arbeit starten" drückt den Startknopf. Während der Arbeit stehen zwei
   Buttons zur Verfügung: **Pause** (Zeit läuft nicht weiter, kann fortgesetzt werden) und
   **Feierabend** (beendet den Tag). Nach "Feierabend" prüfst du kurz die erkannten Zeiten
   und teilst sie danach auf Kostenstellen, Projekte und/oder Labor auf.
2. **Einträge:** Hier lassen sich vergangene oder vergessene Arbeitszeiten manuell
   nachtragen sowie bestehende Einträge antippen, bearbeiten oder löschen.
3. **Kostenstellen:** Kunden/Rechnungsstellen mit Kürzel (z. B. "ACM") und Name anlegen.
   Diese stehen danach bei jedem Eintrag zur Aufteilung zur Verfügung.
4. **Projekte:** Jedes Projekt gehört jetzt zu genau einer Kostenstelle (bei der Anlage
   auswählen). Bei der Zeit-Aufteilung eines Eintrags erscheinen die Projekte einer
   Kostenstelle automatisch erst, sobald du bei dieser Kostenstelle Zeit eingetragen hast.
   Die Zeit-Eingabe erfolgt überall als Uhrzeit-Feld im Format Std:Min (z. B. 01:30).
5. **Profildaten:** Im Export-Tab über „👤 Profildaten bearbeiten" – Vor-/Nachname (erscheint
   im Kopf jedes Monatsblatts sowie jeder Kostenstellen-Tabelle), Arbeitsstunden pro Woche
   und Urlaubstage pro Jahr. Letztere zwei befüllen automatisch die „Stunden pro Woche"- und
   „Urlaub Soll"-Zeilen der Übersicht (weiterhin manuell überschreibbar in Excel, z. B. wenn
   sich die Stunden während des Jahres ändern).
6. **Export:** Erstellt die Excel-Datei mit folgenden Arbeitsblättern, in dieser Reihenfolge:
   - **Übersicht** – Jahresüberblick mit Soll/Ist-Arbeitszeit und Soll/Ist-Urlaub pro Monat plus
     Jahressummen und Differenz. Trage hier einmal pro Monat die „Stunden pro Woche" ein – der
     Tages-Soll-Wert in den Monatsblättern und die Soll-Summe hier berechnen sich automatisch
     per Formel daraus. Die Urlaubszeilen sind einfache, manuell auszufüllende Felder.
   - **Monatsblätter** – ein einziges Arbeitsblatt mit zwölf hintereinander gestapelten
     Tabellen (Jänner bis Dezember), jede im klassischen Arbeitsbericht-Format: pro
     Kalendertag eine Zeile mit Wochentag, Datum, Beginn/Ende, Pause von/bis, gearbeiteten
     Stunden, Tätigkeit und Geschäftsstellen-Kürzel (alle aus deinen Einträgen übernommen).
     Wochenenden bleiben leer. Das Tages-Soll wird nicht mehr als eigene Spalte geführt,
     sondern intern direkt aus der Anzahl Werktage im Monat × „Stunden pro Woche" berechnet.
   - **Gesamt** – wie bisher: alle Tage flach aufgelistet mit einer Spalte je Kostenstelle und
     je Projekt.
   - **Ein Arbeitsblatt pro Kostenstelle** – die zugehörigen Projekte erscheinen darin als
     eigene Spaltenblöcke nebeneinander (Datum | h | davon Labor | Beschreibung), inklusive
     eines „Allgemein"-Blocks für Zeit ohne Projektzuordnung. (Falls mal Zeit einem Projekt,
     aber keiner Kostenstelle zugeordnet wurde, landet das automatisch in einem zusätzlichen
     Arbeitsblatt „Projekte ohne Kostenstelle", damit nichts verloren geht.)
   - **Labor** – die unabhängig erfasste Laborzeit.

   Optional kannst du im Export-Tab einmalig deinen Namen eintragen – er erscheint dann im Kopf
   jedes Monatsblatts.

   **Hinweis:** Die kostenlose Excel-Bibliothek kann Zellformatierungen wie Fett oder Farben
   nur eingeschränkt schreiben (das ist bei der freien SheetJS-Version so vorgesehen, volle
   Formatierung ist ein Pro-Feature). Die App versucht die Monatsnamen fett zu formatieren –
   ob das im geöffneten Excel tatsächlich ankommt, hängt von Excel-Version/Bibliotheksversion
   ab. Falls nicht: Zeile markieren und einmal Strg+B drücken, dauert wenige Sekunden.

## Dateien in diesem Ordner

```
index.html            – App-Gerüst (inkl. Login-Bildschirm)
styles.css             – Design
app.js                 – gesamte Logik (Timer, Speicherung, Sync, Excel-Export)
config.js              – hier deine Supabase-Zugangsdaten eintragen (optional)
supabase-schema.sql    – einmalig in Supabase ausführen (optional, für Sync)
manifest.json          – PWA-Manifest (Name, Icons, Startverhalten)
sw.js                  – Service Worker (Offline-Funktion)
icons/                 – App-Icons
```
