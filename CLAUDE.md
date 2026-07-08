# CLAUDE.md — Arbeitsregeln für dieses Repo

Dieses Repo ist Teil der proprietären CARVILON-Plattform (Copyright (c) 2026
Sascha Daemgen IT and More Systems). Es wird gemeinsam von Sascha und Claude
Code weiterentwickelt. Die folgenden Regeln gelten verbindlich.

## Branch- & Commit-Strategie

* **Direkt auf `main`.** Keine Feature-Branches, keine PRs in dieser Phase.
* **Conventional Commits.** Präfixe u. a.:
  * `feat(shell): …`, `feat(cef): …` – Funktionalität
  * `build: …` – Build-System / Abhängigkeiten
  * `docs: …` – Dokumentation
  * `fix: …`, `refactor: …`, `chore: …`
* Jede Etappe endet mit **einem** aussagekräftigen Commit.
* `Cargo.lock` wird **committet** (Anwendung, keine Bibliothek → reproduzierbare Builds, exakte Versions-Pins).

## Vor jedem Push: Secret-/IP-Grep

Vor jedem `git push` diesen Grep ausführen; er muss leer bleiben (außer
offensichtlichen Platzhaltern/Doku-Treffern, die manuell geprüft werden):

```sh
git grep -nE "192\.168\.|10\.0\.|secret|token|passwor" -- . ':!Cargo.lock' || echo "clean"
```

Grundsatz: **Keine echten IPs, Hostnamen oder Secrets im Repo** – ausschließlich
Platzhalter. CARVILON-interne Adressen gehören nie in die Historie.

## CEF-Binaries

* CEF-Binaries (`libcef.dll`, Ressourcen, Locales, Symbole) kommen **niemals**
  ins Repo. Sie werden über `scripts/fetch-cef.ps1` nach `vendor/cef/` geladen
  (in `.gitignore`).
* Die CEF-Version ist **exakt gepinnt** (Crate-Version in `Cargo.toml`, CEF-
  Distribution in `scripts/fetch-cef.ps1`, dokumentiert in `docs/cyberdesk-decisions.md`).

## Briefing-Treue & Entscheidungen

* Das jeweilige Ticket-Briefing ist die Referenz. Vorgaben werden eingehalten.
* **Begründete Abweichungen sind erlaubt und erwünscht**, wenn sie das Ziel
  besser erreichen – aber sie werden in `docs/cyberdesk-decisions.md` als nummerierte
  Entscheidung (`D-XXXX`, neueste oben) festgehalten.
* Bei echten Blockern nicht stundenlang raten: Zwischenstand committen, Problem
  und Optionen in `docs/cyberdesk-decisions.md` oder `BLOCKER.md` dokumentieren, stoppen.

## Plattform

* Ziel ist **ausschließlich Windows 11 (x64, MSVC)**. Kein Linux/macOS-Support
  in dieser Phase; plattformspezifischer Code ist entsprechend `#[cfg(...)]`-
  gekapselt, wo er später relevant wird.
