import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Plugin: write the correct .htaccess for /pokerroom-mobile/ after build
function mobileHtaccess() {
  return {
    name: 'mobile-htaccess',
    closeBundle() {
      const htaccess = `Options -MultiViews
DirectoryIndex index-mobile.html
RewriteEngine On
RewriteBase /pokerroom-mobile/
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /pokerroom-mobile/index-mobile.html [L]
`
      fs.writeFileSync(path.resolve('dist-mobile/.htaccess'), htaccess)
    },
  }
}

export default defineConfig({
  plugins: [react(), mobileHtaccess()],
  base: '/pokerroom-mobile/',
  resolve: {
    dedupe: ['react', 'react-dom', 'zustand'],
  },
  build: {
    outDir: 'dist-mobile',
    rollupOptions: {
      input: 'index-mobile.html',
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('@react-three')) return 'vendor-three';
          if (id.includes('node_modules/socket.io-client') || id.includes('node_modules/engine.io-client')) return 'vendor-socket';
          if (id.includes('node_modules/zustand')) return 'vendor-store';
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'vendor-react';
          const OVERLAY_COMPONENTS = ['TimingTellTracker','TableCommentary','RangeVisualizer','SpectatorPredict','PauseCoach','StreamOverlay','GTOSolver','CoachingRail','SessionRecap','PredictionMarket','HandHeatmap','GTOOverlay','PostHandCoach','VoiceChat','ProvablyFair','ShareReplay','EquityCalculator','HandReplayViewer','HotkeySettings'];
          if (OVERLAY_COMPONENTS.some(name => id.includes(`/ui/${name}`) || id.includes(`/game/${name}`) || id.includes(`/replay/${name}`))) return 'game-overlays';
          const LOBBY_COMPONENTS = ['AdvancedAnalytics','StakingMarketplace','TournamentBracket','TournamentDirector','HandHistoryImporter','MultiTableView','SocialBracket','BankrollAI','PlayerProfile','NFTBadges'];
          if (LOBBY_COMPONENTS.some(name => id.includes(`/ui/${name}`))) return 'lobby-features';
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
  define: {
    'import.meta.env.VITE_MOBILE': '"true"',
  },
})
