// "Asphalt" — B-29's onboard AI. Speaks Japanese through speech synthesis (no on-screen text),
// keeps a message log for the monitors, and occasionally chats when things are calm.
const LINES = {
  welcome: ['2041年6月1日、地球低軌道、高度420キロ。シラサギ・ステーションを離れました。…ついに出発ですね、カイト。私はアスファルト。この船の管理AIです。これから、よろしくお願いします。'],
  boot: ['おはようございます、カイト。B-29、全システム起動しました。'],
  back: ['おかえりなさい、カイト。前回から{h}が経過しました。'],
  offline_hits: ['留守のあいだに{n}回、衝突がありました。損傷を確認してください。'],
  offline_quiet: ['留守のあいだ、大きな問題はありませんでした。'],
  autopilot_on: ['了解。{name}へ自動航行を開始します。'],
  ap_wreck: ['{name}はもう…残骸しかありません。近くまではお連れしますが、ドッキングはできません。'],
  ap_dark: ['{name}は機能停止中です。近くまでは行けますが、ドッキングは受け付けてもらえません。'],
  autopilot_off: ['自動操縦を解除しました。'],
  autopilot_fail: ['サーバーの損傷で、自動操縦が使えません。'],
  arrived: ['{name}に到着しました。相対速度ゼロで保持しています。'],
  docked: ['ツクヨミ・ドックに接続しました。修理を開始します。…船体の修理が完了しました。おつかれさまでした。'],
  ultra_air: ['大気中でULTRAを使うのは無茶です！ 船体がもちません、すぐに解除してください！'],
  ultra_shudder: ['ULTRAの振動が強くなっています。船体に負荷がかかっています。', '船体がきしんでいます。ULTRAの出力が船の限界に近いです。'],
  ultra_damage: ['ULTRAの振動で{what}が損傷しました。'],
  buckle: ['外板が一枚、内側に曲がりました。金属疲労が進んでいます。', '船体のどこかで金属が裂けました。損傷が広がっています。'],
  danger1: ['船体に損傷があります。構造健全度{pct}パーセント。船内の赤いランプを点灯します。'],
  danger2: ['警告。船体構造が危険な状態です。構造健全度{pct}パーセント。このままでは悪化します。修理基地へ向かってください。'],
  danger3: ['緊急事態。船体構造が限界です。構造健全度{pct}パーセント。いつ壊れてもおかしくありません！'],
  breakup: ['船体が…もちません…！', 'だめです、船が…！'],
  w_hit: ['{name}に隕石が衝突したようです。被害は軽微とのことです。'],
  w_hit_big: ['{name}に小惑星が衝突しました！ 大きな被害が出ています。'],
  w_hit_el: ['宇宙エレベーターのリボンに小惑星が当たりました。'],
  w_damaged: ['{name}は損傷しています。一部の区画が停電しているようです。'],
  w_critical: ['{name}が危険な状態です。救難信号が出ています。'],
  w_failed: ['{name}の全システムが停止しました。明かりも消えています。'],
  w_destroyed: ['{name}が…崩壊しました。'],
  w_damaged_el: ['宇宙エレベーターが損傷しています。クライマーの速度が落ちています。'],
  w_critical_el: ['宇宙エレベーターが危険な状態です。運行が止まりかけています。'],
  w_failed_el: ['宇宙エレベーターが停止しました。クライマーが立ち往生しています。'],
  w_destroyed_el: ['宇宙エレベーターのリボンが…切れました。'],
  w_berth_dark: ['ステーション側の電源が落ちました。こちらの係留は維持していますが、長居はしない方がいいです。'],
  st_dock_start: ['{name}へのドッキングを開始します。ぐるっと回り込んで、エアロック側から接近します。'],
  st_docked: ['{name}にドッキングしました。エアロックの外側ハッチを開ければ、そのままステーションのロビーに入れます。'],
  st_docked_g: ['{name}にドッキングしました。ここは軌道を回らず、地球と一緒に回っています。だから重力が0.9Gほどあります。…外側ハッチから、ロビーへどうぞ。'],
  st_dock_abort: ['ドッキングを中止しました。'],
  st_undock: ['{name}から離脱します。'],
  st_undocked: ['離脱完了。安全な距離まで離れました。'],
  st_dock_hatch: ['離脱の前に、外側ハッチを閉めてください。'],
  st_dock_crew: ['カイトがまだステーションの中です。船に戻ってからにしましょう。'],
  st_dock_far: ['ドッキングできるステーションが近くにありません。まず自動操縦で近づいてください。'],
  st_dock_ultra: ['ULTRA推進中はドッキングできません。'],
  st_docked_ultra: ['ドッキング中はULTRAを使えません。'],
  st_docked_ap: ['ドッキング中です。先に離脱してください。'],
  st_hit: ['{name}の構造物に接触しました！'],
  ultra_on: ['ULTRA推進、点火。慣性ダンパー作動、船内の重力は打ち消します。最大秒速900メートルまで加速します。'],
  ultra_safety: ['船体強度が{pct}%まで落ちています。これ以上は持ちません、ULTRAを止めます。…再始動はできますが、おすすめしません。'],
  ultra_risky: ['…本当にやるんですね。船体が弱っています。何が起きても、責任は持てませんよ。'],
  ultra_off: ['ULTRA解除。段階的に減速します。'],
  ultra_denied: ['エンジンの損傷で、ULTRAは使えません。'],
  impact_micro: ['微小な衝突を検知しました。', 'カツン、と何かが当たりました。船体を確認してください。'],
  impact: ['衝突を検知！船体に損傷があります！'],
  impact_big: ['警告！大きな衝突です！船体が損傷しました！'],
  breach: ['警告。{zone}で気圧が低下しています。空気が漏れています！'],
  breach_big: ['緊急事態！{zone}で急減圧！隔壁を閉鎖します！'],
  window_crack: ['{zone}の窓に、ひびが入りました。'],
  window_broken: ['窓が割れました！{zone}が減圧しています！'],
  pipe: ['配管層で{sys}の漏れを検知しました。だいたい{where}あたりです。'],
  equip: ['{what}に異常があります。'],
  worse: ['{what}の損傷が進行しています。'],
  o2_low: ['酸素分圧が低下しています。気をつけて、カイト。'],
  co2_high: ['二酸化炭素の濃度が上がっています。換気系を確認してください。'],
  pressure_low: ['気圧が危険なレベルです！すぐに安全な区画へ！'],
  asteroid: ['接近物体を検知。{dir}、距離{km}キロ。衝突コースです！', '{dir}から物体が接近中。距離{km}キロ。'],
  asteroid_miss: ['接近物体が{dir}を通過します。…近いですね。'],
  evaded: ['回避成功です。…ふう。'],
  coffee: ['いい香り…と言いたいところですが、私には嗅覚がありません。', 'コーヒーですね。少し休憩しましょう。'],
  coffee_zero_g: ['無重力なので、パウチに入れておきました。こぼさないように。'],
  shower: ['お湯は38度です。ゆっくりどうぞ。', '水は再生していますが、少しずつ減ります。ほどほどに。'],
  shower_zero_g: ['無重力シャワーです。水滴は吸い込み口が集めます。目に入らないように。'],
  repair_ok: ['修理完了。いい腕ですね。'],
  repair_patch: ['応急処置をしました。でも完全には直っていません。悪化に注意してください。'],
  repair_cannot: ['この損傷は船内の設備では直せません。ツクヨミ・ドックまで戻る必要があります。…約10日の旅です。'],
  kit_empty: ['修理キットの資材が足りません。'],
  need_kit: ['修理キットを持ってきてください。倉庫の赤いケースです。'],
  reentry: ['大気圏に突入しています！船体温度、上昇中！'],
  reentry_hot: ['船体温度が限界に近づいています！減速してください！'],
  landing: ['着地を確認。…地球へようこそ、カイト。'],
  splash: ['着水しました。…浮いています、たぶん。'],
  crash: ['衝撃に備えて！'],
  gravity: ['重力を検知。足元に気をつけてください。'],
  suit_on: ['宇宙服、装着完了。生命維持、正常です。'],
  suit_off: ['宇宙服を脱ぎました。'],
  eva_out: ['船外に出ました。命綱はありません。気をつけて。'],
  eva_far: ['船から{m}メートル離れています。戻れる距離を意識してください。'],
  eva_o2: ['宇宙服の酸素が残り少なくなっています。船内へ戻ってください。'],
  airlock_dep: ['エアロックを減圧します。'],
  airlock_rep: ['エアロックを加圧します。'],
  airlock_ready: ['減圧完了。外部ハッチを開けられます。'],
  hatch_denied: ['宇宙服を着ていないと、ハッチは開けられません。', 'エアロックが加圧されています。先に減圧してください。'],
  door_pressure: ['扉の両側で気圧差があります。開けられません。'],
  door_jammed: ['扉が変形して動きません。別の経路を探してください。'],
  silenced: ['警報を消音しました。'],
  lockdown: ['隔壁を閉鎖しました。'],
  sleep: ['おやすみなさい、カイト。見張りは私に任せてください。'],
  wake: ['おはようございます。{h}眠っていましたよ。'],
  idle: [
    '今日も地球はきれいですね。',
    '軌道上では、90分ごとに日の出が来ます。',
    'カイト、コーヒーでもどうですか。',
    '5G中継局の信号、良好です。',
    '小学生のころの夢、ちゃんと叶いましたね。',
    '宇宙は静かですね。…私は、この静けさが好きです。',
    'そろそろ休憩しませんか。',
    '夜側の地球。人の営みが、光になって見えます。',
    'この船、中古ですけど…いい船ですよ。私が保証します。',
    '原子炉、出力安定。あと9年以上、電力の心配はいりません。',
    '窓の外、見てください。きれいな薄明です。',
  ],
  sunrise: ['日の出です。', 'まもなく日の出です。'],
  dying: ['カイト…応答してください…カイト…'],
  low_power: ['電力が不足しています。不要な系統を切ります。'],
  reactor_hot: ['原子炉の温度が上昇しています。冷却材が漏れているかもしれません。'],
  comms_lost: ['5G回線が途切れました。アンテナが損傷しているようです。'],
  sleep_denied: ['警報が鳴っているあいだは、眠らないでください。'],
  saved: ['航行記録を保存しました。'],
  repress: ['予備タンクから再加圧します。'],
  water_in: ['海の中です！浮力で浮いていますが、気をつけて。'],
  eva_back: ['おかえりなさい。船内に戻りました。'],
  fuel_low: ['推進剤が残り少ないです。'],
  liftoff: ['離陸。重力に気をつけて。'],
  dock_far: ['ドックに接続できる位置にいません。'],
  hurt: ['カイト、大丈夫ですか！？', '強い衝撃でした…ケガはありませんか。'],
  eva_impact: ['危ない！すぐ近くに衝突がありました！'],
  breach_patched: ['穴をふさぎました。再加圧できます。'],
};

export class Asphalt {
  constructor(game) {
    this.g = game;
    this.log = [];
    this.queue = [];
    this.speaking = false;
    this.voice = null;
    this.voiceOn = true;
    this.lastKey = {};
    this.idleT = 240 + Math.random() * 300;
    this.glitch = 0;
    if ('speechSynthesis' in window) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        this.voice = vs.find((v) => /ja[-_]JP/i.test(v.lang) && /Kyoko|O-ren|Google|Nanami|Haruka/i.test(v.name)) || vs.find((v) => /ja/i.test(v.lang)) || null;
      };
      pick();
      speechSynthesis.onvoiceschanged = pick;
    }
  }

  unlock() {
    if (!('speechSynthesis' in window)) return;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* ignore */ }
  }

  say(key, params = {}, { force = false, minGap = 20 } = {}) {
    const arr = LINES[key];
    if (!arr) return;
    const now = performance.now() / 1000;
    if (!force && this.lastKey[key] && now - this.lastKey[key] < minGap) return;
    this.lastKey[key] = now;
    let text = arr[Math.floor(Math.random() * arr.length)];
    for (const [k, v] of Object.entries(params)) text = text.replaceAll('{' + k + '}', v);
    // server damage garbles the voice
    const sv = this.g.damage ? this.g.damage.health.servers : 1;
    if (sv < 0.5 && Math.random() < 0.6) text = text.replace(/(.)(.)/, '$1…$1$2');
    this.log.push({ t: this.g.time, text, key });
    if (this.log.length > 60) this.log.shift();
    this.queue.push(text);
    this._next();
  }

  _next() {
    if (this.speaking || !this.queue.length) return;
    const text = this.queue.shift();
    this.g.audio.chime && this.g.audio.chime();
    if (!this.voiceOn || !('speechSynthesis' in window)) { this.speaking = true; setTimeout(() => { this.speaking = false; this._next(); }, 1800); return; }
    this.speaking = true;
    setTimeout(() => {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ja-JP';
        if (this.voice) u.voice = this.voice;
        const sv = this.g.damage ? this.g.damage.health.servers : 1;
        u.rate = sv < 0.5 ? 0.85 : 1.02;
        u.pitch = sv < 0.5 ? 0.7 : 1.08;
        u.volume = 0.9;
        u.onend = u.onerror = () => { this.speaking = false; setTimeout(() => this._next(), 250); };
        speechSynthesis.speak(u);
        // safety timeout
        setTimeout(() => { if (this.speaking) { this.speaking = false; this._next(); } }, 15000);
      } catch (e) { this.speaking = false; }
    }, 420);
  }

  update(dt, calm) {
    if (!calm) { this.idleT = Math.max(this.idleT, 120); return; }
    this.idleT -= dt;
    if (this.idleT <= 0) {
      this.idleT = 420 + Math.random() * 600;
      this.say('idle', {}, { minGap: 300 });
    }
  }
}
