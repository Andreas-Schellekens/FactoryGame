import * as PIXI from 'pixi.js';

function makeButton({ label, width = 120, height = 34, onClick }) {
    const container = new PIXI.Container();
    container.eventMode = 'static';
    container.cursor = 'pointer';

    const bg = new PIXI.Graphics();
    const text = new PIXI.Text({
        text: label,
        style: { fill: 0xffffff, fontSize: 14, fontFamily: 'system-ui, Segoe UI, Roboto, sans-serif' },
    });

    function redraw(hovered = false, pressed = false) {
        bg.clear();
        const base = hovered ? 0x343a4a : 0x2a2f3a;
        const color = pressed ? 0x3a4260 : base;
        bg.roundRect(0, 0, width, height, 8);
        bg.fill(color);
        bg.roundRect(0, 0, width, height, 8);
        bg.stroke({ width: 1, color: 0x5a6380, alpha: hovered ? 1 : 0.6 });
    }

    redraw(false, false);

    text.anchor.set(0.5);
    text.x = width / 2;
    text.y = height / 2;

    container.addChild(bg, text);

    let hovered = false;
    let pressed = false;

    container.on('pointerover', () => {
        hovered = true;
        redraw(hovered, pressed);
    });
    container.on('pointerout', () => {
        hovered = false;
        pressed = false;
        redraw(hovered, pressed);
    });
    container.on('pointerdown', (e) => {
        pressed = true;
        redraw(hovered, pressed);
        e.stopPropagation();
    });
    container.on('pointerup', (e) => {
        const wasPressed = pressed;
        pressed = false;
        redraw(hovered, pressed);
        e.stopPropagation();
        if (wasPressed) onClick?.();
    });
    container.on('pointerupoutside', () => {
        pressed = false;
        redraw(hovered, pressed);
    });

    return { container, setLabel: (v) => (text.text = v) };
}

export function createUI({ width, onToolChange, onRotate, onTogglePause, onSpeedChange, getState }) {
    const ui = new PIXI.Container();
    ui.eventMode = 'static';
    ui.zIndex = 1000;

    const panel = new PIXI.Graphics();
    panel.eventMode = 'none';
    ui.addChild(panel);

    const title = new PIXI.Text({
        text: 'Factory',
        style: { fill: 0xffffff, fontSize: 18, fontWeight: '600', fontFamily: 'system-ui, Segoe UI, Roboto, sans-serif' },
    });
    title.eventMode = 'none';
    title.x = 12;
    title.y = 10;
    ui.addChild(title);

    const moneyText = new PIXI.Text({
        text: '',
        style: { fill: 0xd7dde9, fontSize: 14, fontFamily: 'system-ui, Segoe UI, Roboto, sans-serif' },
    });
    moneyText.eventMode = 'none';
    moneyText.x = 12;
    moneyText.y = 36;
    ui.addChild(moneyText);

    const hoverText = new PIXI.Text({
        text: '',
        style: { fill: 0xb8c0d6, fontSize: 12, fontFamily: 'ui-monospace, Consolas, monospace' },
    });
    hoverText.eventMode = 'none';
    hoverText.x = 12;
    hoverText.y = 56;
    ui.addChild(hoverText);

    const beltBtn = makeButton({
        label: '1 Belt',
        onClick: () => onToolChange?.('belt'),
    });
    beltBtn.container.x = 12;
    beltBtn.container.y = 84;
    ui.addChild(beltBtn.container);

    const eraseBtn = makeButton({
        label: '2 Erase',
        onClick: () => onToolChange?.('erase'),
    });
    eraseBtn.container.x = 12 + 120 + 10;
    eraseBtn.container.y = 84;
    ui.addChild(eraseBtn.container);

    const rotateBtn = makeButton({
        label: 'R Rotate',
        width: 120,
        onClick: () => onRotate?.(),
    });
    rotateBtn.container.x = 12 + (120 + 10) * 2;
    rotateBtn.container.y = 84;
    ui.addChild(rotateBtn.container);

    const pauseBtn = makeButton({
        label: 'Space Pause',
        width: 140,
        onClick: () => onTogglePause?.(),
    });
    pauseBtn.container.x = 12;
    pauseBtn.container.y = 84 + 34 + 10;
    ui.addChild(pauseBtn.container);

    const slowerBtn = makeButton({
        label: '- Slower',
        width: 120,
        onClick: () => onSpeedChange?.(-1),
    });
    slowerBtn.container.x = 12 + 140 + 10;
    slowerBtn.container.y = 84 + 34 + 10;
    ui.addChild(slowerBtn.container);

    const fasterBtn = makeButton({
        label: '+ Faster',
        width: 120,
        onClick: () => onSpeedChange?.(1),
    });
    fasterBtn.container.x = 12 + 140 + 10 + 120 + 10;
    fasterBtn.container.y = 84 + 34 + 10;
    ui.addChild(fasterBtn.container);

    const help = new PIXI.Text({
        text: 'LMB build • RMB erase • R rotate • Space pause',
        style: { fill: 0xaab3c7, fontSize: 12, fontFamily: 'system-ui, Segoe UI, Roboto, sans-serif' },
    });
    help.eventMode = 'none';
    help.x = 12;
    help.y = 84 + (34 + 10) * 2 + 2;
    ui.addChild(help);

    const panelHeight = help.y + 20;

    function redrawPanel() {
        panel.clear();
        panel.roundRect(0, 0, width, panelHeight, 0);
        panel.fill({ color: 0x12151c, alpha: 0.9 });
        panel.roundRect(0, panelHeight - 1, width, 1, 0);
        panel.fill({ color: 0x2b3140, alpha: 1 });
    }

    redrawPanel();

    ui.update = () => {
        const s = getState?.();
        if (!s) return;
        moneyText.text = `Money: ${s.money}   Tool: ${s.tool.toUpperCase()}   Dir: ${s.dir.replace('belt_', '')}`;
        hoverText.text = s.hoverText ?? '';
        pauseBtn.setLabel(s.paused ? 'Space Resume' : 'Space Pause');
    };

    return ui;
}

