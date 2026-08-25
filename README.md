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

## Wichtiger Hinweis zu den Daten

Alle Einträge und Kostenstellen werden **lokal im Browser des jeweiligen Geräts**
gespeichert (nicht in einer Cloud, nicht synchronisiert zwischen Handy und Rechner). Das
heißt:

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
5. **Export:** Erstellt die Excel-Datei mit folgenden Arbeitsblättern, in dieser Reihenfolge:
   - **Übersicht** – Jahresüberblick mit Soll/Ist-Arbeitszeit und Soll/Ist-Urlaub pro Monat plus
     Jahressummen und Differenz. Trage hier einmal pro Monat die „Stunden pro Woche" ein – der
     Tages-Soll-Wert in den Monatsblättern und die Soll-Summe hier berechnen sich automatisch
     per Formel daraus. Die Urlaubszeilen sind einfache, manuell auszufüllende Felder.
   - **Monatsblätter** – ein einziges Arbeitsblatt mit zwölf hintereinander gestapelten
     Tabellen (Jänner bis Dezember), jede im klassischen Arbeitsbericht-Format: pro
     Kalendertag eine Zeile mit Wochentag, Datum, Beginn/Ende, Pause von/bis, gearbeiteten
     Stunden, Tätigkeit, Geschäftsstellen-Kürzel (alle aus deinen Einträgen übernommen), einem
     freien Feld „davon BESN" und dem automatisch berechneten Tages-Soll. Wochenenden bleiben
     leer.
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

   **Hinweis:** Die kostenlose Excel-Bibliothek kann keine Zellfarben/Formatierungen (z. B.
   rosa Wochenend-Zeilen) schreiben – Struktur, Formeln und Zahlen stimmen, Farben müsstest du
   bei Bedarf in Excel selbst per bedingter Formatierung ergänzen.

## Dateien in diesem Ordner

```
index.html      – App-Gerüst
styles.css      – Design
app.js          – gesamte Logik (Timer, Speicherung, Excel-Export)
manifest.json   – PWA-Manifest (Name, Icons, Startverhalten)
sw.js           – Service Worker (Offline-Funktion)
icons/          – App-Icons
```
