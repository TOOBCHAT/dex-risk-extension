# Solana DEX Risk Scanner 🔍🛡️

A powerful browser extension designed for Solana traders to identify risk, honeypots, and rug pulls directly on DexScreener. 

The extension integrates with **RugCheck API** (`api.rugcheck.xyz`) for on-chain security data and performs real-time scraping of DexScreener’s DOM for trading activity metrics, analyzing them under a weighted mathematical risk scoring algorithm.

---

## 🚀 Key Features

* **Solana-Focused**: Tailored specifically for the Solana network.
* **Dual-Source Analysis**: Combines on-chain security parameters (RugCheck) with live trading metrics (DexScreener DOM).
* **4-Tier Risk Classification**:
  * 🟢 **LOW RISK**: High security scores, locked LP, and normal trading activity.
  * 🟡 **MEDIUM RISK**: Minor issues (e.g., higher holder concentration, young token age).
  * 🔴 **HIGH RISK**: Significant warning signs (e.g., unlocked LP, suspicious buy/sell ratios).
  * ☠️ **CRITICAL RISK**: Verified scams (e.g., active freeze authority, mint authority enabled, or insider wallet dumps).
* **Interactive Badges**: Injects visual badges directly into DexScreener table rows. Hovering over a badge reveals a detailed tooltip showing a visual score bar, on-chain security checks, and trading statistics.
* **Persistent Cache**: Scored tokens are cached in memory to prevent refetching during scrolling.

---

## 🛠️ The Dual-Source Risk Algorithm

Risk scores (0–100) are computed dynamically using a weighted blend of:
1. **On-Chain Security (70% Weight)**:
   * Mint Authority (Enabled = ☠️ Critical)
   * Freeze Authority (Enabled = ☠️ Critical)
   * LP Lock Status & Percentages
   * Holder Concentration (Whales)
   * Insider / Developer Wallet activity
2. **Trading Activity (30% Weight)**:
   * Token Age / Longevity
   * Buy/Sell Transaction Ratios (Honeypot detection)
   * Volume-to-Market-Cap Ratios (Wash trading detection)
   * Price Volatility and Crash Indicators

---

## 📥 How to Install the Extension in Your Browser

To use this extension, you need to load it as an **unpacked extension** in your browser. Follow these steps:

### Option A: Install from a Pre-built Archive (Easiest)
If you are downloading this from GitHub:
1. Go to the **Actions** tab of this repository.
2. Click on the most recent workflow run.
3. Scroll down to **Artifacts** and download the `solana-dex-risk-scanner` zip file.
4. Extract the zip file to a folder on your computer.
5. Follow the **Load Unpacked Extension** steps below.

---

### Option B: Build from Source
If you want to build it yourself:
1. Ensure you have **Node.js** (v18 or higher) installed.
2. Open your terminal, navigate to the folder:
   ```bash
   cd dex-risk-extension
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build the extension:
   ```bash
   npm run build
   ```
   This will compile the TypeScript/React code and output the extension package into the `dist/` directory.

---

### 🔌 Load Unpacked Extension (Chrome, Brave, Edge)
Once you have the compiled code (either from the **Pre-built Archive** or the **`dist/`** folder from building it yourself):

1. Open your browser and go to the Extensions page:
   * **Chrome**: Visit `chrome://extensions/`
   * **Brave**: Visit `brave://extensions/`
   * **Edge**: Visit `edge://extensions/`
2. Enable **Developer mode** using the toggle switch (usually found in the top-right corner).
3. Click the **Load unpacked** button (usually in the top-left corner).
4. Select the **`dist`** directory (or the extracted folder if you used Option A).
5. The extension is now active! Open [DexScreener](https://dexscreener.com/solana) and start scanning.

---

## 📁 Project Structure

* `src/content/`: Contains content scripts that scrape DexScreener rows and inject the risk badges.
* `src/background/`: Manages background tasks, caches token reports, and communicates with the RugCheck API.
* `src/options/`: Options UI where users can customize threshold ranges and settings.
* `manifest.json`: Configuration for extension permissions and background service worker registration.
* `.github/workflows/`: Automated GitHub Action to test and package the extension on every push.

---

## 🤝 Contributors

* **Snehashis Chatterjee** (Lead Author) - [GitHub Profile](https://github.com/TOOBCHAT)
* **Aman Patel** (Co-Lead) - [GitHub Profile](https://github.com/amanpatel1208)

*This project was developed by Snehashis Chatterjee (Lead Author) and Aman Patel (Co-Lead).*
