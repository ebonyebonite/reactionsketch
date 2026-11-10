// 上部バー: 検索・編集操作・メニュー (コマンド登録簿から描く)
import { createContext, useContext, useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { setState, toast, useStore } from '../editor/store';
import { allCommands, getCommand, runCommand, type CommandGroup } from '../editor/commands';
import { addImageFromBlob } from '../editor/objects';
import { openFiles } from '../io/open';
import { SearchBox } from './SearchBox';
import { Icons } from './icons';

/** メニューの区切り (小見出しとコマンド id の並び) */
interface MenuSection {
  heading?: string;
  ids: string[];
}

/** group のコマンドを登録順に、section ごとにまとめる */
function sectionsOfGroup(group: CommandGroup, first: string[] = []): MenuSection[] {
  const out: MenuSection[] = [];
  const cmds = allCommands().filter((c) => c.group === group);
  // first に挙げた section を先に、残りは現れた順
  const order = [...first];
  for (const c of cmds) if (c.section && !order.includes(c.section)) order.push(c.section);
  for (const sec of order) {
    const ids = cmds.filter((c) => c.section === sec).map((c) => c.id);
    if (ids.length) out.push({ heading: sec, ids });
  }
  const rest = cmds.filter((c) => !c.section).map((c) => c.id);
  if (rest.length) out.push({ heading: order.length ? 'その他' : undefined, ids: rest });
  return out;
}


const CALC_SECTIONS = (): MenuSection[] => [
  { heading: '物性・計算', ids: ['calc.spectra', 'calc.view3d', 'calc.polymer', 'calc.reagents', 'calc.salt'] },
  { heading: '構造の確認', ids: ['calc.find', 'calc.showH', 'calc.hideH', 'calc.terminalCH3'] },
];

const HELP_SECTIONS = (): MenuSection[] => [
  { ids: ['help.open', 'help.tour', 'app.palette', 'app.settings'] },
];

const FILE_SECTIONS = (): MenuSection[] => [
  { heading: 'タブ', ids: ['tab.new', 'file.open', 'file.saveProject', 'tab.reopenClosed', 'file.history'] },
  { heading: '共有・書き出し', ids: ['file.share', 'file.export', 'file.print'] },
  { heading: '形式を選んで保存', ids: ['file.savePng', 'file.saveSvg', 'file.savePdf', 'file.savePdfAll', 'file.saveCdxml', 'file.saveMol', 'file.saveSdf', 'file.saveRxn'] },
  { heading: 'コピー', ids: ['file.copySmiles', 'file.copyInchi', 'file.copyInchikey', 'file.copyRxnSmiles', 'file.copyMolfile', 'file.copySmarts', 'file.copyCxsmiles'] },
];

const MORE_SECTIONS = (): MenuSection[] => [
  { heading: '整形', ids: ['edit.clean', 'edit.layout', 'edit.next'] },
  { heading: 'ヘルプ', ids: ['help.open', 'help.tour', 'app.palette', 'app.settings'] },
];

// ---- メニュー (キーボード操作つき) ----

interface MenuBarCtx {
  open: string | null;
  setOpen: (key: string | null, focus?: 'first' | 'last' | null) => void;
  focusReq: 'first' | 'last' | null;
}
const MenuBar = createContext<MenuBarCtx>({ open: null, setOpen: () => undefined, focusReq: null });

function menuButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('.topbar .menu > .top-btn')].filter((b) => b.offsetParent !== null);
}

function menuItems(pop: HTMLElement): HTMLElement[] {
  return [...pop.querySelectorAll<HTMLElement>('[role=menuitem]')];
}

function Menu({ id, label, icon, sections, className = '', lblClass = 'lbl-p1', wide = false }: {
  id: string;
  label: string;
  icon: JSX.Element;
  sections: () => MenuSection[];
  className?: string;
  lblClass?: string;
  /** 項目が多いメニュー (広い画面では 2 列) */
  wide?: boolean;
}) {
  const { open: openKey, setOpen, focusReq } = useContext(MenuBar);
  const open = openKey === id;
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open, setOpen]);

  // キーボードで開いたら項目へフォーカス
  useEffect(() => {
    if (!open || !popRef.current) return;
    const items = menuItems(popRef.current);
    if (focusReq === 'first') items[0]?.focus();
    else if (focusReq === 'last') items[items.length - 1]?.focus();
    else popRef.current.focus({ preventScroll: true });
  }, [open, focusReq]);

  const closeToButton = () => {
    setOpen(null);
    btnRef.current?.focus();
  };

  const moveToSibling = (dir: 1 | -1) => {
    const btns = menuButtons();
    const i = btns.indexOf(btnRef.current!);
    if (i < 0 || !btns.length) return;
    const next = btns[(i + dir + btns.length) % btns.length];
    const key = next.dataset.menu;
    if (key) {
      setOpen(key, 'first');
      next.focus();
    }
  };

  const onBtnKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(id, 'first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(id, 'last');
    } else if (open && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      moveToSibling(e.key === 'ArrowRight' ? 1 : -1);
    } else if (open && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeToButton();
    }
  };

  const onPopKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(e.currentTarget);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const focus = (j: number) => items[(j + items.length) % items.length]?.focus();
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focus(i + 1); break;
      case 'ArrowUp': e.preventDefault(); focus(i < 0 ? items.length - 1 : i - 1); break;
      case 'Home': e.preventDefault(); focus(0); break;
      case 'End': e.preventDefault(); focus(items.length - 1); break;
      case 'ArrowRight': e.preventDefault(); moveToSibling(1); break;
      case 'ArrowLeft': e.preventDefault(); moveToSibling(-1); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); closeToButton(); break;
      case 'Tab': setOpen(null); break;
      default: return;
    }
    // キャンバスのキー操作に渡さない
    e.stopPropagation();
  };

  const secs = open ? sections() : [];
  return (
    <div className={`menu ${className}`} ref={ref}>
      <button
        ref={btnRef}
        className={`top-btn ${open ? 'on' : ''}`}
        data-menu={id}
        onClick={() => setOpen(open ? null : id, null)}
        onKeyDown={onBtnKey}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `menu-${id}` : undefined}
        aria-label={label}
        data-tip={open ? undefined : label}
      >
        {icon}
        <span className={`lbl ${lblClass}`}>{label}</span>
        <svg className="caret" viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div ref={popRef} id={`menu-${id}`} className={`menu-pop ${wide ? 'wide' : ''}`} role="menu" aria-label={label} tabIndex={-1} onKeyDown={onPopKey}>
          {secs.map((sec, si) => (
            <div className="menu-sec" key={si} role="group" aria-label={sec.heading}>
              {sec.heading && <div className="menu-head" aria-hidden="true">{sec.heading}</div>}
              {sec.ids.map((cid) => <CommandItem key={cid} id={cid} onDone={() => setOpen(null)} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommandItem({ id, onDone }: { id: string; onDone: () => void }) {
  const c = getCommand(id);
  if (!c) return null;
  const enabled = !c.enabled || c.enabled();
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={`menu-item ${enabled ? '' : 'off'}`}
      aria-disabled={!enabled || undefined}
      onClick={() => {
        if (!enabled) return;
        onDone();
        runCommand(id);
      }}
    >
      <span>{c.title}</span>
      {c.shortcut && <kbd>{c.shortcut}</kbd>}
    </button>
  );
}

/** 上部バーのボタン (コマンドを実行。ラベルとツールチップはコマンドから) */
function CmdButton({ id, icon, label, lblClass, className = '', tip }: { id: string; icon: JSX.Element; label: string; lblClass?: string; className?: string; tip?: string }) {
  const c = getCommand(id);
  // 元に戻せるかなどで薄くする
  const enabled = useStore(() => !c?.enabled || c.enabled());
  return (
    <button
      className={`top-btn ${className}`}
      onClick={() => runCommand(id)}
      disabled={!enabled}
      aria-label={label}
      data-tip={tip ?? c?.description ?? c?.title ?? label}
      data-key={c?.shortcut}
    >
      {icon}
      {lblClass && <span className={`lbl ${lblClass}`}>{label}</span>}
    </button>
  );
}

const Sep = () => <span className="top-sep" aria-hidden="true" />;

export function TopBar() {
  const panelOpen = useStore((s) => s.panelOpen);
  const [open, setOpenKey] = useState<string | null>(null);
  const [focusReq, setFocusReq] = useState<'first' | 'last' | null>(null);
  const ctx: MenuBarCtx = {
    open,
    focusReq,
    setOpen: (key, focus = null) => {
      setOpenKey(key);
      setFocusReq(focus);
    },
  };
  const autoSections = () => sectionsOfGroup('自動描画', ['テキストから', '反応', '構造', '整形']);
  const insertSections = () => sectionsOfGroup('挿入', ['構造', '図', '投影式・配座', '例題']);

  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><polygon points="12,2.5 20.2,7.25 20.2,16.75 12,21.5 3.8,16.75 3.8,7.25" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8 12.5c0-3 3-5 6-3.5" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" /><path d="M13 7l2.4 1.8-1.8 2" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" /></svg>
        <span>ReactionSketch</span>
      </div>
      <SearchBox />
      <MenuBar.Provider value={ctx}>
        <div className="top-actions" role="toolbar" aria-label="操作">
          <CmdButton id="edit.undo" icon={Icons.undo} label="元に戻す" />
          <CmdButton id="edit.redo" icon={Icons.redo} label="やり直す" />
          <Sep />
          <span className="top-group wide-only">
            <CmdButton id="edit.clean" icon={Icons.clean} label="整える" lblClass="lbl-p3" />
            <CmdButton id="edit.layout" icon={Icons.layout} label="整列" lblClass="lbl-p3" />
            <CmdButton id="edit.next" icon={Icons.next} label="次の構造" lblClass="lbl-p3" />
            <Sep />
          </span>
          <Menu id="auto" label="自動描画" icon={Icons.wand} sections={autoSections} wide />
          <Menu id="calc" label="計算" icon={Icons.calc} sections={CALC_SECTIONS} />
          <Menu id="insert" label="挿入" icon={Icons.insert} sections={insertSections} wide />
          <Sep />
          <CmdButton id="file.copyPng" icon={Icons.copy} label="PNG コピー" lblClass="lbl-p2" className="primary" tip="PNG をコピー (Word などに貼り付け)" />
          <CmdButton id="file.share" icon={Icons.share} label="共有" lblClass="lbl-p2" />
          <Menu id="file" label="ファイル" icon={Icons.save} sections={FILE_SECTIONS} />
          <Sep />
          {/* 狭い画面では 整える・整列・次の構造・設定・ヘルプ をこのメニューにまとめる */}
          <Menu id="more" label="その他" icon={Icons.more} sections={MORE_SECTIONS} className="narrow-only" lblClass="lbl-none" />
          <CmdButton id="app.palette" icon={Icons.command} label="コマンド検索" lblClass="lbl-p4" className="cmd-search" tip="すべての操作を名前で探して実行" />
          <span className="top-group wide-only">
            <CmdButton id="app.settings" icon={Icons.settings} label="設定" />
          </span>
          <Menu id="help" label="ヘルプ" icon={Icons.help} sections={HELP_SECTIONS} className="wide-only" lblClass="lbl-none" />
          <button
            className={`top-btn ${panelOpen ? 'on' : ''}`}
            onClick={() => setState({ panelOpen: !panelOpen })}
            aria-label="プロパティパネル"
            aria-pressed={panelOpen}
            data-tip={panelOpen ? 'プロパティパネルを隠す' : 'プロパティパネルを表示'}
          >
            {Icons.panel}
          </button>
        </div>
      </MenuBar.Provider>
      <FileInputs />
    </header>
  );
}

/** 「開く」「画像を挿入」用の隠れた入力欄 (コマンドから id でクリックする) */
function FileInputs(): ReactNode {
  return (
    <>
      <input
        id="file-input"
        type="file"
        hidden
        multiple
        accept=".rsketch,.json,.cdxml,.mol,.sdf,.rxn,.smi,.txt"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          openFiles(files).catch((err: Error) => toast(err.message, 'error'));
        }}
      />
      <input
        id="image-input"
        type="file"
        hidden
        accept="image/*"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          for (const fl of files) addImageFromBlob(fl).catch((err: Error) => toast(err.message, 'error'));
        }}
      />
    </>
  );
}
