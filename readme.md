📘 README.md — javinizer-js
Obiettivo del progetto

Creare un’applicazione javinizer-like, scritta in Node.js, con:

scraper modulari (in futuro)

WebUI per editing manuale dei metadata

supporto a librerie già esistenti

compatibilità con Jellyfin / Kodi

nessuna dipendenza dal file video reale

Cloudflare gestibile manualmente (in futuro)

Il focus iniziale è la modalità EDIT, non lo scraping.

Filosofia di base

Il modello dati è indipendente da:

scraper

file video

formato di esportazione

I metadata possono esistere anche senza file video

Se un campo è vuoto:

un’altra fonte può riempirlo

mai sovrascrivere dati esistenti

Niente merge complessi:

ogni campo viene scritto una sola volta

Il filesystem è contesto, non fonte di verità

Struttura della libreria (assunta come standard)
Movies/
 ├── SDDM-943/
 │    ├── SDDM-943.mp4        (opzionale)
 │    ├── SDDM-943.nfo        (sempre presente)
 │    ├── folder.jpg | poster.jpg
 │    ├── fanart.jpg
 │    └── altri file → ignorati


Una cartella è valida se contiene un file .nfo

Il nome del .nfo è sempre l’ID

I file video non sono obbligatori

Jellyfin può arricchire il .nfo con dati tecnici (runtime reale, risoluzione ecc.)

questi dati non sono usati per l’edit

al massimo sono visualizzati

Modello dati canonico (v1)
{
  "id": "",
  "code": "",

  "title": "",
  "originalTitle": "",

  "releaseDate": "",
  "runtime": null,

  "studio": "",
  "label": "",
  "series": "",
  "director": "",

  "plot": "",
  "tagline": "",
  "contentRating": "XXX",

  "genres": [],
  "tags": [],

  "rating": {
    "value": null,
    "votes": null
  },

  "actor": [
    {
      "name": "",
      "altName": "",
      "role": "",
      "thumb": ""
    }
  ],

  "images": {
    "poster": "",
    "fanart": []
  },

  "local": {
    "path": "",
    "files": [],
    "video": ""
  },

  "meta": {
    "createdAt": "",
    "updatedAt": "",
    "locked": false
  }
}

Architettura attuale (modalità EDIT)
📁 src/core/libraryReader.js

Navigazione libreria

Cartelle valide = contengono .nfo

Supporta:

getCurrent()

getNext()

getPrevious()

reloadCurrent()

Usato dalla WebUI per le frecce avanti/indietro

📁 src/core/readNfo.js

Legge un file .nfo

Parsing XML → oggetto JS (xml2js)

Non fa mapping

📁 src/core/nfoMapper.js

Converte l’oggetto XML parsato

→ modello dati canonico

Campo per campo, senza merge

📁 src/core/localMediaMapper.js

Arricchisce il modello con dati locali:

local.path

local.files

immagini (folder.jpg / poster.jpg, fanart.jpg)

local.video (opzionale, informativo)

