# MyVoice Studio - PWA

Your customized AI vocalist. Upload your demos to get detailed vocal analysis and weekly plans to improve your vocal quality.

## Features

✨ **Home Page Features:**
- Welcome header with app introduction
- Search functionality to filter songs
- Upload demos (MP3 format) with custom or random cover images
- 3-column responsive grid layout
- Day/Night mode toggle
- Now Playing page (Spotify/YouTube Music style player)
- AI Vocal Analysis modal (save/regenerate/close)
- Smooth animations and gradient backgrounds
- PWA capabilities for mobile installation

## Files Structure

```
mobile app/
├── index.html          # Main HTML file
├── now-playing.html    # Now Playing page
├── styles.css          # Styling with light/dark mode
├── script.js           # JavaScript functionality
├── now-playing.js      # Player + AI analysis modal logic
├── manifest.json       # PWA manifest
├── service-worker.js   # Service worker for offline support
├── app - icon.png      # App icon
├── server\             # Optional backend for real GPT analysis (keeps API keys off the client)
└── README.md          # This file
```

## How to Deploy as PWA on Your Phone

### Option 1: Using Local Server (Recommended)

1. **Install a local server:**
   - If you have Python installed:
     ```bash
     python -m http.server 8000
     ```
   - Or install `live-server` globally:
     ```bash
     npm install -g live-server
     live-server
     ```

2. **Find your computer's IP address:**
   - Windows: Open Command Prompt and type `ipconfig`
   - Look for "IPv4 Address" (e.g., 192.168.1.100)

3. **On your phone:**
   - Make sure your phone is on the same WiFi network
   - Open browser (Chrome/Safari) and go to: `http://YOUR-IP-ADDRESS:8000`
   - Example: `http://192.168.1.100:8000`

4. **Install PWA on Phone:**
   - **Android (Chrome):** Tap the three dots → "Add to Home screen"
   - **iOS (Safari):** Tap the share button → "Add to Home Screen"

### Option 2: Deploy to a Web Host

1. **Free hosting options:**
   - **Netlify:** Drag and drop your folder at netlify.com
   - **Vercel:** Connect your project at vercel.com
   - **GitHub Pages:** Push to GitHub and enable Pages

2. **Once deployed, visit the URL on your phone and install as PWA**

## Features Implemented

### HTML Elements
✅ Big heading: "Welcome to MyVoice Studio!"  
✅ Subheading with app description  
✅ Search field with placeholder "Search for a song..."  
✅ "My Playlist" section heading  
✅ Upload button for demos (MP3) and cover images  
✅ 3-column grid layout for demos  
✅ Day/Night mode toggle button  

### CSS Styling
✅ Warm and minimalist design  
✅ Gradient background (consistent across light/dark modes)  
✅ Proper spacing between sections and buttons  
✅ Square images with border-radius  
✅ Song names aligned left below covers  
✅ Presentable sun/moon icon for theme toggle  
✅ Smooth transitions and hover effects  

### JavaScript Functionality
✅ Scroll support for 12+ demos (grid auto-scrolls)  
✅ Search filtering (shows only matching demos)  
✅ Upload modal for demo + cover image  
✅ Random Pexels images if no cover uploaded  
✅ Local storage persistence  
✅ Theme toggle with localStorage  
✅ Responsive design for mobile devices  

### PWA Features
✅ manifest.json for app installation  
✅ Service worker for offline support  
✅ App icon configuration  
✅ Standalone display mode  

## Usage

1. **Upload a Demo:**
   - Click "Upload Demo" button
   - Select an MP3 file
   - Enter song name
   - Optionally select a cover image (or let the app choose a random one)
   - Click "Upload"

2. **Search for Songs:**
   - Type in the search field
   - Grid will filter to show only matching songs

3. **Toggle Theme:**
   - Click the sun/moon icon in the top-right corner
   - Preference is saved automatically

4. **View Demos:**
   - Click on any demo card to open it
   - Opens the **Now Playing** page with playback controls

## AI Vocal Analysis (GPT) – Secure Setup (Recommended)

This project **does not put API keys in the browser**. For real GPT output, use the optional Node server in `server/` which exposes:

- `POST /api/analyze` → returns `{ analysis: string }`

### Run the server locally

1) Install dependencies:

```bash
cd server
npm install
```

2) Set environment variables (see `server/ENV.example`):

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (defaults to `gpt-5.2`)
- `PORT` (defaults to `8787`)

3) Start:

```bash
npm start
```

4) Open `http://localhost:8787` (Now Playing will call `/api/analyze` automatically).

## Browser Requirements

- **Chrome/Edge:** Full PWA support
- **Safari (iOS):** PWA support with Add to Home Screen
- **Firefox:** Basic PWA support

## Next Steps (Future Pages)

- Song Analysis Page (Page 2)
- Vocal Report Page (Page 3)
- AI integration for vocal analysis
- Weekly practice plans

## Notes

- Demo metadata is stored in `localStorage`
- Uploaded audio + uploaded cover images are stored in `IndexedDB` so the Now Playing page can play them after navigation
- For production, you'll want to implement backend storage
- Cover images from Pexels are randomly selected if not uploaded
- The app is fully responsive and works on all screen sizes

---

**Enjoy building your vocal skills with MyVoice Studio! 🎵**

