# Jetson Ollama Control Panel

A lightweight web interface for managing and chatting with [Ollama](https://ollama.ai) language-models on NVIDIA Jetson boards (tested on the **Jetson Orin Nano 8 GB**).  
It bundles:

* **Frontend** – React + Tailwind CSS single-page app that lets you
  * select / pull / delete local models
  * chat with a selected model (streamed responses)
  * monitor live CPU / GPU / RAM / temperature gauges (≈2 Hz)
* **Backend helper** – small Flask server (`stats_server.py`) that wraps the
  `tegrastats` command so the browser can read system stats.
* **Deploy script** – `deploy_and_run.sh` sets everything up on a fresh Jetson
  (installs prerequisites, pulls latest code, installs Node/Python deps, builds
  the frontend, starts both servers).

---

## Demo

![screenshot](docs/screenshot.png)

---

## 1 · Prerequisites

| Software | Tested version | Notes |
|----------|----------------|-------|
| JetPack SDK | 5.1 / Ubuntu 22.04 | Any Jetson running `tegrastats` should work |
| Ollama | 0.1.29+ | Follow the [arm64 install guide](https://github.com/ollama/ollama/blob/main/docs/linux.md) |
| Python | ≥ 3.8 | `python3 --version` |
| Node.js | ≥ 18 | `node --version` (the script installs via apt if missing) |
| Git | any | used by `deploy_and_run.sh` |

> **Tip:** Make sure Port `11434` (Ollama) is listening before you open the panel:
> ```bash
> ollama serve &   # or systemctl start ollama
> ```

---

## 2 · Quick Start (recommended)

```bash
# clone once
git clone https://github.com/yourname/JetsonOllamaControlPanel.git
cd JetsonOllamaControlPanel

# first run – makes the script executable
chmod +x deploy_and_run.sh

# every time after that
./deploy_and_run.sh
```

* Frontend served on **http://&lt;JETSON_IP&gt;:3000**  
* Stats API on **http://&lt;JETSON_IP&gt;:5001/api/system-stats**

Logs are written to `frontend.log` and `stats_server.log` (backgrounded with `nohup`).

---

## 3 · Manual Installation (dev workflow)

### Backend helper
```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt    # Flask, psutil, etc.
python stats_server.py             # runs on :5001
```

### Frontend
```bash
cd frontend
npm install           # installs React, Tailwind, react-markdown …
npm start             # dev-server on :3000 with hot-reload
```

### Environment Variables
The frontend attempts to autodetect API hosts, but you can override:

```bash
# example .env file inside frontend/
REACT_APP_OLLAMA_API_URL=http://192.168.1.42:11434
REACT_APP_STATS_API_URL=http://192.168.1.42:5001
```

---

## 4 · Features in Detail

### ✨ Model Management
* **Pull** any remote model by name → live download progress.
* **Delete** a local model (uses `DELETE /api/delete`).
* **Dropdown** above the chat box switches models on the fly.
* **RAM guard-rail** – chat button disables if free RAM &lt; 1.5× model size.

### ✨ Chat Interface
* Streaming responses with a "Thinking…" placeholder.
* GitHub-flavoured Markdown rendering (`react-markdown` + `remark-gfm` + `remark-breaks`).
* Syntax-highlight-ready code blocks and inline code styling.
* Scrollable chat pane capped to viewport height.

### ✨ Resource Gauges
* CPU %, GPU %, RAM usage, SOC temperature.
* Updated every 0.5 s using `tegrastats --interval 100`.

---

## 5 · Project Structure

```
NvidiaOrinNano/
├── deploy_and_run.sh         # one-click setup/start script
├── stats_server.py           # Flask + tegrastats JSON API
├── frontend/                 # React app
│   ├── src/                  # components, Tailwind config, etc.
│   └── tailwind.config.js
├── requirements.txt          # backend Python deps (if any)
└── README.md
```

---

## 6 · Troubleshooting

| Symptom | Fix |
|---------|-----|
| **Green dot turns red** & "Could not connect to stats helper" | Check that `stats_server.py` is running and port 5001 is reachable. |
| Chat repeats words / shows no breaks | Pull latest code – streaming logic & Markdown plugins fix this. |
| Jetson freezes when loading large model | The RAM guard-rail disables chat until enough free memory is available. |
| `deploy_and_run.sh` prints `npm ci` errors | The script falls back to `npm install`; warnings are safe to ignore. |

---

## 7 · Extending

* Add more gauges → edit `ResourceGauge` in `frontend/src/App.js`.
* Improve syntax highlighting → swap the simple `<code>` renderer for `react-syntax-highlighter`.
* Reduce CPU usage → modify `stats_server.py` to keep `tegrastats` running and stream JSON.

Pull requests are welcome! 💚

---

## 8 · License

This project is licensed under the MIT License – see the [LICENSE](LICENSE) file for details. 