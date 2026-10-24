// Corner button that shows where the visitor statistics are, and what is collected.
import { useState } from 'react';
import { analytics, dashboardUrl, isConfigured } from '../lib/analytics';
import { Modal } from './Dialogs';

export function VisitorStats() {
  const [open, setOpen] = useState(false);
  const url = dashboardUrl();
  return (
    <>
      <button type="button" className="stats-corner" onClick={() => setOpen(true)} data-testid="visitor-stats-btn" aria-haspopup="dialog">Visitor stats</button>
      {open && (
        <Modal title="Visitor statistics" label="Visitor statistics" testid="visitor-stats" onClose={() => setOpen(false)}>
          {isConfigured() && url ? (
            <>
              <p>See how many people use this site, which countries they visit from, which pages they open and which sites send them here. The figures come from a separate statistics page.</p>
              <p><a href={url} target="_blank" rel="noopener noreferrer" data-testid="stats-link">Open the statistics page <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a></p>
            </>
          ) : (
            <p data-testid="stats-not-set">Visitor statistics are not switched on for this site yet. The site owner can turn them on by putting a free {analytics.provider === 'goatcounter' ? 'GoatCounter' : 'statistics'} site code in <code>src/data/analytics.json</code>; see the README. Nothing is collected until then.</p>
          )}
          <h3>What is counted</h3>
          <ul>
            <li>Page visits, the country (worked out from the network address, which is not stored), the browser type and the page that sent the visitor.</li>
            <li>No cookies, no names, and nothing about the scenarios you build. Those stay in your browser.</li>
            <li>Nothing is counted if your browser sends Do Not Track, or when the site runs on your own computer.</li>
          </ul>
          <div className="row"><button type="button" onClick={() => setOpen(false)}>Close</button></div>
        </Modal>
      )}
    </>
  );
}
