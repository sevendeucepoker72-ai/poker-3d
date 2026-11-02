/**
 * LegalBug — the legal line, always on air (lead spec C3 + §3
 * ProgramState.legal, 2026-11-02): 'Free to play · Play money only · No
 * purchase necessary · 21+ to enter.', plus the platform line when the server sends one.
 * Without a program it still shows the contract's line.
 */
import { memo } from 'react';
import { LEGAL_LINE } from '../../model/contract.js';

function LegalBug({ program, layout = '16x9' }) {
  const legal = program && program.legal ? program.legal : null;
  const line = legal && typeof legal.line === 'string' && legal.line.trim() ? legal.line.trim() : LEGAL_LINE;
  const platform = legal && typeof legal.platformLine === 'string' && legal.platformLine.trim() ? legal.platformLine.trim().slice(0, 120) : '';
  return (
    <div className="bc-legal-line" data-layout={layout}>
      <span>{line}</span>
      {platform ? <span className="bc-legal-line__platform">{platform}</span> : null}
    </div>
  );
}

export default memo(LegalBug);
