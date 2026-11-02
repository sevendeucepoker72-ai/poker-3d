/**
 * SceneBoard — scenes and the two Auto switches (lead spec C6 + C4,
 * 2026-11-02). A scene button pins that scene (`bc:producer:setScene`
 * {channel, scene}); Auto scene hands it back to the page's scene machine
 * (`setAuto` {channel, scene:true}); Auto table lets the server pick the
 * featured table (`setAuto` {channel, table:true}). Results never go on air
 * before the program reaches the finish, even when pinned (the page holds
 * them). The OBS sources can be reloaded only from the slate or the break
 * (the page enforces it too); Identify flashes each source's channel and layout.
 */
import { SCENE_BUTTONS, RELOAD_SCENES, isObj } from './producerModel.js';

export default function SceneBoard({ program, channel, call }) {
  const scene = program && isObj(program.scene) ? program.scene : null;
  const featured = program && isObj(program.featured) ? program.featured : null;
  const autoScene = !scene || scene.auto !== false;
  const autoTable = !featured || featured.mode !== 'producer';
  const reloadOk = !!scene && RELOAD_SCENES.includes(scene.id);
  return (
    <div className="bcp-card">
      <div className="bcp-card__title">Scenes</div>
      <div className="bcp-scenes">
        {SCENE_BUTTONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`bcp-btn bcp-scene${scene && scene.id === s.id ? ' bcp-btn--on' : ''}`}
            onClick={() => call('setScene', { channel, scene: s.id }, `Scene: ${s.label}.`)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="bcp-row">
        <label className="bcp-check">
          <input
            type="checkbox"
            checked={autoScene}
            onChange={(e) => call('setAuto', { channel, scene: e.target.checked }, e.target.checked ? 'Auto scenes on.' : 'Auto scenes off: the pinned scene stays.')}
          />
          Auto scene
        </label>
        <label className="bcp-check">
          <input
            type="checkbox"
            checked={autoTable}
            onChange={(e) => call('setAuto', { channel, table: e.target.checked }, e.target.checked ? 'Auto featured table on.' : 'Auto featured table off.')}
          />
          Auto featured table
        </label>
      </div>
      <div className="bcp-row">
        <button type="button" className="bcp-btn bcp-btn--ghost" onClick={() => call('command', { channel, cmd: 'identify' }, 'Identify sent to the OBS sources.')}>
          Identify sources
        </button>
        <button
          type="button"
          className="bcp-btn bcp-btn--ghost"
          disabled={!reloadOk}
          title={reloadOk ? 'Reload the OBS sources' : 'Only from the slate or the break scene'}
          onClick={() => call('command', { channel, cmd: 'reload' }, 'Reload sent to the OBS sources.')}
        >
          Reload sources
        </button>
      </div>
      {!reloadOk ? <div className="bcp-hint">Reload sources works only from the Slate or the Break scene.</div> : null}
    </div>
  );
}
