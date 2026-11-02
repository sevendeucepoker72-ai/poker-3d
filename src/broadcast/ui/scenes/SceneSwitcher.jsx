/**
 * SceneSwitcher — CLB's scenes for the broadcast page (lead spec C4,
 * 2026-11-02). BroadcastApp picks this module up (import.meta.glob) and
 * passes SCENE_PROPS: layout, motion, program, table, tables, events, feed,
 * delayMs, onAir, stale, feedHealth, now, serverNow, programNow, TableView,
 * onSceneShown.
 *
 * The scene on air is model/sceneMachine.chooseScene(program, programNow,
 * stale): pure, so the 16:9 and 9:16 sources agree, a stale feed always gives
 * the slate, a producer pin beats auto, results wait for the program clock to
 * reach the finish, and the final-table intro plays once per event.
 *
 * A change of scene is a 600 ms crossfade with a gold sweep (transform and
 * opacity only; none with motion=reduced). The legal line, the delay bug and
 * the lower thirds sit above the scenes and never fade with them.
 */
import { useEffect, useState } from 'react';
import { chooseScene } from '../../model/sceneMachine.js';
import StartingSoonScene from './StartingSoonScene.jsx';
import TableScene from './TableScene.jsx';
import BreakScene from './BreakScene.jsx';
import FinalIntroScene from './FinalIntroScene.jsx';
import ResultsScene from './ResultsScene.jsx';
import SlateScene from './SlateScene.jsx';
import RoomScene from './RoomScene.jsx';
import RecapScene from './RecapScene.jsx';
import LegalBug from '../graphics/LegalBug.jsx';
import DelayBug from '../graphics/DelayBug.jsx';
import LowerThirds from '../graphics/LowerThirds.jsx';

const TRANSITION_MS = 600;

function renderScene(id, props, choice) {
  const common = {
    program: props.program,
    programNow: props.programNow,
    layout: props.layout,
  };
  switch (id) {
    case 'starting':
      return <StartingSoonScene {...common} />;
    case 'table':
    case 'hfh':
      return (
        <TableScene
          {...common}
          hfh={id === 'hfh'}
          table={props.table}
          events={props.events}
          feed={props.feed}
          serverNow={props.serverNow}
          TableView={props.TableView}
        />
      );
    case 'break':
      return <BreakScene {...common} />;
    case 'finalIntro':
      return <FinalIntroScene {...common} pinned={!!(choice && choice.pinned)} />;
    case 'results':
      return <ResultsScene {...common} />;
    case 'room':
      return <RoomScene {...common} tables={props.tables} />;
    case 'recap':
      return <RecapScene {...common} />;
    case 'slate':
    default:
      return <SlateScene {...common} reason={choice && choice.id === 'slate' ? choice.reason : ''} />;
  }
}

export default function SceneSwitcher(props) {
  const { program, programNow, stale, onSceneShown, motion, layout, feed, delayMs } = props;
  const choice = chooseScene({ program, programNow, stale });

  // "Storing information from previous renders": the scene that is leaving.
  const [cur, setCur] = useState(choice.id);
  const [prev, setPrev] = useState(null);
  if (choice.id !== cur) {
    setPrev(motion === 'reduced' ? null : cur);
    setCur(choice.id);
  }

  useEffect(() => {
    if (!prev) return undefined;
    const t = setTimeout(() => setPrev(null), TRANSITION_MS);
    return () => clearTimeout(t);
  }, [prev, cur]);

  useEffect(() => {
    if (typeof onSceneShown === 'function') onSceneShown(cur);
  }, [cur, onSceneShown]);

  return (
    <div className="bc-scenes" data-scene={cur} data-scene-reason={choice.reason}>
      {prev ? (
        <div className="bc-scene-layer bc-scene-layer--out" key={`out-${prev}`} aria-hidden="true">
          {renderScene(prev, props, null)}
        </div>
      ) : null}
      <div className={`bc-scene-layer${prev ? ' bc-scene-layer--in' : ''}`} key={`in-${cur}`}>
        {renderScene(cur, props, choice)}
      </div>
      {prev ? <div className="bc-sting" key={`sting-${cur}`} /> : null}
      {cur !== 'slate' ? <LowerThirds program={program} programNow={programNow} layout={layout} /> : null}
      <DelayBug feed={feed} delayMs={delayMs} layout={layout} />
      {cur !== 'slate' ? <LegalBug program={program} layout={layout} /> : null}
    </div>
  );
}
