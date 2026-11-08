import { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './store';
import { CaptureTab } from './tabs/CaptureTab';
import { PairsTab } from './tabs/PairsTab';
import { CatalogTab } from './tabs/CatalogTab';
import { WallsTab } from './tabs/WallsTab';
import { LayoutTab } from './tabs/LayoutTab';
import { InstallTab } from './tabs/InstallTab';
import { SettingsTab } from './tabs/SettingsTab';
import './styles.css';

const TABS = ['capture', 'pairs', 'catalog', 'walls', 'layout', 'install', 'settings'] as const;
type Tab = (typeof TABS)[number];

const LABELS: Record<Tab, string> = {
  capture: 'Capture', pairs: 'Pairs', catalog: 'Catalog',
  walls: 'Walls', layout: 'Layout', install: 'Install', settings: 'Settings',
};

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const { ready, loadError, pairs, layout, settings, walls } = useStore();
  const [tab, setTab] = useState<Tab>(() => {
    const h = window.location.hash.replace('#', '');
    return (TABS as readonly string[]).includes(h) ? (h as Tab) : 'capture';
  });
  const [highlightPairId, setHighlightPairId] = useState<string | null>(null);

  useEffect(() => {
    window.location.hash = tab;
  }, [tab]);

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace('#', '');
      if ((TABS as readonly string[]).includes(h)) setTab(h as Tab);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const showOnWall = (id: string) => { setHighlightPairId(id); setTab('layout'); };

  const needsAttention: Partial<Record<Tab, boolean>> = {
    walls: walls.some((w) => w.bandBottomIn === null || w.bandTopIn === null) || settings.bracketCount === null,
    settings: settings.hardware.plateToArmTopIn === null,
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row">
          <div className="brand">
            ShoeWall
            <small>textural sneaker wall planner</small>
          </div>
        </div>
        <nav className="tabs" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              className="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
            >
              {LABELS[t]}
              {t === 'pairs' && pairs.length ? <span className="badge">{pairs.length}</span> : null}
              {t === 'install' && layout ? <span className="badge">{layout.bracketsUsed}</span> : null}
              {needsAttention[t] ? <span className="badge" title="Something needs entering">!</span> : null}
            </button>
          ))}
        </nav>
      </header>

      <main role="tabpanel" aria-label={LABELS[tab]}>
        {loadError ? (
          <div className="notice bad" role="alert">
            <strong>Could not open this browser&rsquo;s storage</strong>
            <p style={{ margin: '.3rem 0 0' }}>{loadError}</p>
            <p style={{ margin: '.3rem 0 0' }}>
              ShoeWall keeps everything in IndexedDB on this device, so until that works nothing can be saved or
              loaded. It is usually private browsing, or site data blocked for this site. Try a normal window, allow
              site data, and reload. Your project is not lost — it is still in whichever browser profile saved it.
            </p>
          </div>
        ) : null}
        {!ready ? (
          <div className="card"><p className="muted">Loading your project…</p></div>
        ) : tab === 'capture' ? (
          <CaptureTab onSaved={() => setTab('pairs')} />
        ) : tab === 'pairs' ? (
          <PairsTab onShowOnWall={showOnWall} goCapture={() => setTab('capture')} />
        ) : tab === 'catalog' ? (
          <CatalogTab onShowOnWall={showOnWall} />
        ) : tab === 'walls' ? (
          <WallsTab />
        ) : tab === 'layout' ? (
          <LayoutTab
            highlightPairId={highlightPairId}
            clearHighlight={() => setHighlightPairId(null)}
            goWalls={() => setTab('walls')}
            goCapture={() => setTab('capture')}
          />
        ) : tab === 'install' ? (
          <InstallTab goLayout={() => setTab('layout')} goSettings={() => setTab('settings')} />
        ) : (
          <SettingsTab />
        )}
      </main>
    </div>
  );
}
