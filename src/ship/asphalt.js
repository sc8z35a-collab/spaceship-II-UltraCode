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
  danger2_air: ['警告。ここの気圧が{kpa}キロパスカルまで下がっています。気密の保たれた区画へ移るか、宇宙服を着てください。'],
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
  w_secondary: ['{name}で二次爆発です！ 中で火災が広がっています。', '{name}でまた爆発がありました。状態が悪化しています。'],
  w_pods: ['{name}から脱出ポッドが射出されています…乗員が避難を始めました。', '{name}の乗員が脱出ポッドで退避しています。'],
  w_debris: ['デブリです！ {name}の破片が当たっています。離れてください！', '破片が船体に当たっています！ {name}から距離を取ってください。'],
  w_berth_dark: ['ステーション側の電源が落ちました。こちらの係留は維持していますが、長居はしない方がいいです。'],
  st_dock_start: ['{name}へのドッキングを開始します。ぐるっと回り込んで、エアロック側から接近します。'],
  st_docked: ['{name}にドッキングしました。エアロックの外側ハッチを開ければ、そのままステーションのロビーに入れます。'],
  st_docked_g: ['{name}にドッキングしました。ここは軌道を回らず、地球と一緒に回っています。だから重力が0.9Gほどあります。…外側ハッチから、ロビーへどうぞ。'],
  st_dock_abort: ['ドッキングを中止しました。'],
  el_climber_up: ['{line}のクライマー{id}が下から上がってきます。窓の外、リボンの下のほうを見ていてください。', '地上からクライマーが到着します。{line}の{id}です。'],
  el_climber_down: ['{line}のクライマー{id}が上から降りてきます。もうすぐ上のバースに入ります。', '静止軌道のほうからクライマーが戻ってきました。{id}です。'],
  st_undock: ['{name}から離脱します。'],
  st_undocked: ['離脱完了。安全な距離まで離れました。'],
  st_dock_hatch: ['離脱の前に、外側ハッチを閉めてください。'],
  st_dock_crew: ['カイトがまだステーションの中です。船に戻ってからにしましょう。'],
  st_dock_far: ['ドッキングできるステーションが近くにありません。まず自動操縦で近づいてください。'],
  st_dock_ultra: ['ULTRA推進中はドッキングできません。'],
  st_docked_ultra: ['ドッキング中はULTRAを使えません。'],
  st_docked_ap: ['ドッキング中です。先に離脱してください。'],
  st_hit: ['{name}の構造物に接触しました！'],
  fracture: ['{zone}の壁に亀裂が走りました。…今は小さいですが、放っておくと伸びます。', '{zone}の内壁にひびが入りました。構造の疲労です。', '{zone}で壁が割れる音がしました。亀裂です。'],
  ring_arrive: ['シラサギのリング居住区です。リングの回転で、床には{g}Gほどの重さがあります。…前を見てください、床が上に向かって曲がっていくでしょう？', 'リング居住区に着きました。重さは{g}Gくらい。足元のガラスの下を、星が流れていきますよ。'],
  ring_leave: ['ハブに戻りました。ここからはまた無重力です。手すりの帯につかまれば、チューブを運んでくれます。'],
  ring_dark: ['エレベーターは止まっています。電源が落ちています。…スポークの中のはしごを使うしかありません。長い登り降りになります。'],
  st_breach: ['{name}の{sec}に穴が開きました！ 減圧しています。ステーションが隔壁を閉鎖しました。', 'ステーションの{sec}で減圧！ 気密扉がロックされました。'],
  st_breach_here: ['カイト、そこが減圧しています！ 船に戻るか、宇宙服を！', 'カイト、この区画の空気が抜けています！ 急いで船へ！'],
  st_sealed: ['カイトのいる区画は隔壁で閉じられています。空気は保たれています。…いまは扉を開けないでください。'],
  st_air_ok: ['{sec}の気圧が戻りました。隔壁のロックが解除されます。'],
  st_port_low: ['ロビー側の気圧が下がっています。ハッチを閉めれば、船内の空気は守れます。'],
  st_gone: ['カイト！ ステーションが…！ 宇宙服がない…！ 船に戻って、すぐに！'],
  st_gone_suit: ['カイト！ 無事ですか!? ステーションが崩れました。宇宙服は生きています。船まで泳いで戻ってきて。待っています。'],
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
  // H8 (Kaito's old sub-base) — Asphalt's side
  h8_call: ['H8に呼びかけます。…応答あり。HACHIが起きました。距離は{d}です。'],
  h8_docked: ['H8の結合を確認しました。…久しぶりですね、ハチ。'],
  h8_undocked: ['H8、離脱しました。'],
  h8_port_none: ['上部ポートの外は真空です。H8が結合していないと開けられません。'],
  h8_link_down: ['サーバーが損傷していて、H8と通信できません。'],
  h8_zap_thanks: ['…HACHIが撃ち落としました。助かりました。'],
  h8_hint: ['そういえばカイト。昔のサブ拠点のH8が、ちょうどこの船の真上に浮かんでいます。ナビ画面の左上から呼べますよ。…呼べば、HACHIが自分で降りてきて、この船の背中にドッキングします。'],
  h8_out_of_range: ['H8は通信圏外です。距離{d}。1500キロ以内に近づかないと、呼ぶことも話すこともできません。'],
  h8_no_fuel: ['H8の推進剤が足りません。ここまで来るのに約{need}キロ必要ですが、残りは{kg}キロです。こちらから迎えに行きましょう。'],
  h8_link_up: ['H8との通信がつながりました。距離{d}です。'],
  h8_link_lost: ['H8との通信が途切れました。距離{d}、圏外です。'],
  h8_called: ['HACHIから呼び出しです。了解、H8へ向かいます。距離{d}。推進剤を使います。'],
  h8_called_undock: ['HACHIから呼び出しです。ステーションを離れてから、H8へ向かいます。'],
  b29_report: ['こちらB-29、アスファルトです。現在、{state}。推進剤{fuel}パーセント、船体の健全度{integ}パーセント、電力{pw}パーセントです。'],
  ultra_nofuel: ['推進剤が足りません。ULTRAは使えません。'],
  fuel_out: ['推進剤が尽きました！ 予備スラスターに切り替えます。ゆっくりしか動けません。ステーションで補給してください。'],
  b29_fuel_low: ['推進剤の残りが{pct}パーセントです。ステーションにドッキングすれば補給できます。'],
  b29_refuel: ['ステーションから推進剤を補給しています。'],
  b29_refueled: ['推進剤、満タンになりました。'],
  // the hunter drones and B-29's defence gun
  drones_contact: ['警告！ 無人機を{n}機探知しました。こちらに向かってきます！ 武装しています！', 'カイト、無人の攻撃機が{n}機、接近中です！ 機関砲を持っています！'],
  hit_shot: ['被弾しています！ 外板に弾痕が増えています！', '撃たれています！ 船体に命中！', 'また当たりました！ 同じ場所に集中すると穴が開きます！'],
  drone_down: ['無人機を撃墜しました。残り{left}機です。', '一機、落ちました。残りは{left}機。'],
  pd_auto_on: ['防衛機銃、自動迎撃に切り替えます。近づく無人機は私が撃ちます。'],
  pd_auto_off: ['防衛機銃を手動にしました。発射ボタンで撃てます。'],
  pd_ammo_out: ['防衛機銃の弾が尽きました。ステーションで補給してください。'],
  w_shot: ['{name}に弾が当たっています！ 撃つのをやめてください！', '{name}を撃っています！ 民間のステーションですよ、カイト！'],
  b29_rearm: ['ステーションで弾薬を補給しました。'],
  asp_relay_h8: ['HACHIから連絡です。H8が被弾しました。外部装甲{pct}パーセント。'],
  asp_split: ['了解、{b}は私が撃ちます。', '{b}を引き受けます、HACHI。'],
  h8_leak_port: ['H8の船内から空気が漏れています。ドッキングポートでつながっているので、こちらの空気も一緒に抜けています！ ハッチを閉めるか、H8の穴をふさいでください。'],
};

// HACHI — H8's AI: terse, dry, very sure of itself
const HACHI = {
  hachi_wake: ['HACHI、起動。…ずいぶん待たせたな、カイト。距離{d}、そっちへ向かう。', 'HACHI、起動。久しぶりだな、カイト。今から行く。距離{d}。'],
  hachi_coming: ['了解。B-29へ向かう。距離{d}。'],
  hachi_meet: ['B-29を確認。ここからは私がやる。上部ポートに付ける。'],
  hachi_final: ['最終進入。B-29の上部ポートに合わせる。そのまま姿勢を保ってくれ。'],
  hachi_docked: ['ラッチ閉鎖、結合完了。H8の推力をB-29に回す。給電があれば、最大12倍だ。'],
  hachi_reply: ['アスファルト。相変わらず丁寧だな。'],
  hachi_undock: ['ラッチ解放。H8、離脱する。上で待機している。'],
  hachi_undock_crew: ['ラッチ解放、離脱する。…操縦は任せる、カイト。'],
  hachi_manual: ['安全距離に出た。操縦をそちらへ渡す。'],
  hachi_home: ['停泊軌道へ戻る。用があれば呼べ。'],
  hachi_parked: ['停泊軌道に到着。省電力モードに入る。'],
  hachi_arrived: ['{name}に到着。相対位置を保持する。'],
  hachi_hatch_closing: ['ハッチを閉める。少し待て。'],
  hachi_vestibule: ['ハッチの間に人がいる。離脱できない。'],
  hachi_busy: ['B-29がドッキング操作中だ。終わるまで待つ。'],
  hachi_feed_on: ['給電を受ける。ブースト出力が使える。'],
  hachi_feed_off: ['給電を切った。内部電源だけだと、推力は6倍までだ。'],
  hachi_boost_on: ['ブースト、許可。'],
  hachi_boost_off: ['ブースト解除。巡航出力で行く。'],
  hachi_zap: ['レーザー照射。岩塊を除去した。', '迎撃完了。小石だ、問題ない。', '進路上の岩を焼いた。'],
  hachi_big_rock: ['大きい岩だ、焼き切れない。距離{km}キロ。回避機動に入る。'],
  hachi_rock: ['岩塊接近、距離{km}キロ。大きい。回避する。'],
  hachi_rock_small: ['小石が来る。距離{km}キロ。迎撃する。'],
  hachi_hit: ['被弾。外部装甲で止めた。残り{pct}パーセント。'],
  hachi_hit_hard: ['被弾。外部装甲が薄くなってきた。残り{pct}パーセント。'],
  hachi_leak: ['内部装甲を抜かれた。船内の気圧が下がる。B-29へ戻れ、カイト。'],
  hachi_bump: ['接触した。装甲が厚くて助かったな。'],
  hachi_enter: ['ようこそ、カイト。…狭いのは昔のままだ。'],
  hachi_no_link: ['B-29と通信できない。距離{d}。1500キロ以内に近づけ。'],
  hachi_b29_landed: ['B-29は地上だ。呼んでも上がってこられない。'],
  hachi_b29_coming: ['B-29はもうこちらへ向かっている。距離{d}。'],
  hachi_b29_nofuel: ['B-29の推進剤が足りない。必要なのは{need}キロ、残りは{kg}キロだ。こっちから行くしかない。'],
  hachi_call_b29: ['B-29、こちらH8。こっちへ来てくれ。距離{d}。'],
  hachi_report: ['こちらH8、HACHI。{state}。推進剤{fuel}パーセント、外部装甲{arm}パーセント、蓄電{smes}パーセント。'],
  hachi_fuel_low: ['推進剤が残り{pct}パーセントだ。B-29に戻って補給したい。'],
  hachi_fuel_out: ['推進剤が切れた。予備スラスターしか使えない。B-29に迎えに来てもらえ。'],
  hachi_xfer_b29: ['H8の推進剤をB-29へ送る。'],
  hachi_xfer_h8: ['B-29から推進剤をもらう。'],
  hachi_xfer_stop: ['推進剤の移送を止めた。'],
  hachi_cam_lost: ['{cam}がやられた。その方向の映像が出ない。'],
  hachi_hole: ['外部装甲を抜かれた。穴が開いている。残り{pct}パーセント。'],
  hachi_drones_contact: ['無人機だ。{n}機、{who}に向かってくる。武装している。迎撃準備。', '敵性の無人機を{n}機捕捉。狙いは{who}だ。砲を出す。'],
  hachi_drone_hit: ['{id}に命中。', '{id}、被弾。まだ飛んでいる。'],
  hachi_drone_down: ['{id}撃墜。残り{left}機。', '{id}を落とした。あと{left}機。'],
  hachi_drone_down_station: ['ステーションの防衛砲が{id}を落とした。残り{left}機。'],
  hachi_drone_dry: ['{id}が離れていく。弾切れだな。…また来るぞ。'],
  hachi_drones_clear: ['無人機の反応が消えた。…警戒は続ける。'],
  hachi_rock_kill: ['岩を砕いた。'],
  hachi_auto_on: ['自動迎撃、開始。近づくものは私が撃つ。'],
  hachi_auto_off: ['自動迎撃を切った。撃つのはそっちだ、カイト。'],
  hachi_ammo_out: ['弾切れだ。ステーションで補給するまで撃てない。'],
  hachi_rail_charging: ['レールガン充電中。{pct}パーセント。'],
  hachi_no_target: ['目標がない。'],
  hachi_rail_blocked: ['その方向はH8の船体が邪魔で撃てない。'],
  hachi_salvo: ['ミサイル、{n}発発射。', 'ミサイル{n}発、追尾開始。'],
  hachi_suit_out: ['スーツを出す。左の収納庫だ。', '小型スーツ、出すぞ。私と回線をつないである。'],
  hachi_suit_on: ['スーツ装着を確認。こちらとリンクした。酸素、推進剤、正常。外の案内は私がする。'],
  hachi_suit_off: ['スーツを外した。収納する。'],
  hachi_suit_keep: ['船内の気圧が低い。今は脱ぐな。'],
  hachi_follow_on: ['{name}を自動追従。ズームを合わせる。'],
  hachi_follow_off: ['追従を解除した。'],
  hachi_follow_none: ['追従できる目標がない。まずロックしろ。'],
  hachi_follow_lost: ['追従目標を見失った。'],
  hachi_scramble_near: ['B-29が狙われている。H8、起動して迎撃に入る。上は任せろ。', 'H8、戦闘起動。B-29の上につく。'],
  hachi_scramble: ['B-29が狙われている。H8、援護に向かう。距離{d}。', '無人機がB-29に向かっている。今から行く、持ちこたえろ。距離{d}。'],
  // outside work: the suit, the airlock in the shaft and the field repairs
  hachi_eva_out: ['船外に出たな。命綱はないぞ。修理箇所はバイザーに出す。', '外だ。H8の外板に沿って動け。直す所は印をつけてある。'],
  hachi_eva_back: ['戻ったな。お疲れ、カイト。'],
  hachi_eva_nosuit: ['スーツなしで外には出せない。左の収納庫から出せ。'],
  hachi_eva_hold: ['カイトが船外にいる。エンジンは止めて、この位置を保持する。'],
  hachi_kit_empty: ['{what}が残っていない。スーツを収納庫に戻せば補充できる。'],
  hachi_fix_hole: ['{name}をふさぐ。パッチを当てて、縁を押さえていろ。'],
  hachi_fix_cam: ['{name}の配線をつなぎ直す。…応急処置だ、画質は戻りきらない。'],
  hachi_fix_circuit: ['{name}をバイパスする。予備の部品を差し込め。'],
  hachi_fixed_hole: ['穴はふさがった。漏れが止まる。…きれいな仕事だ。'],
  hachi_fixed: ['{name}、仮復旧。ちゃんと直すならB-29に戻ってからだ。', '{name}、つながった。応急処置としては十分だ。'],
  hachi_lock_dep: ['シャフトを減圧する。空気はタンクに戻す。もったいないからな。'],
  hachi_lock_rep: ['外ハッチを閉める。シャフトを再加圧する。'],
  hachi_lock_open: ['減圧完了。外ハッチを開けた。外は真空だ、気をつけろ。'],
  hachi_lock_closed: ['再加圧完了。床のハッチを開けていい。'],
  hachi_hatch_pressure: ['シャフトと操縦室の気圧が違う。このままでは開けられない。'],
  hachi_guide: ['{name}はそこから{m}メートル先だ。印を追え。'],
  hachi_circuit: ['{name}がやられた。外の接続箱だ。船外から応急処置できる。'],
  // HACHI's mind: the air, the drones, the order of repairs, B-29 over the link, questions
  hachi_free: ['{text}'],
  hachi_port_leak: ['H8の穴から、ポート越しにB-29の空気まで抜けている。通路が毎分{r}キロパスカル下がっている。ハッチを閉めろ。閉めないなら私が閉める。'],
  hachi_port_seal: ['H8側のハッチを閉めた。B-29の空気はこれで守れる。穴は外からふさげ。'],
  hachi_air_suit: ['船内の気圧が毎分{r}キロパスカルで落ちている。あと{t}で危険域だ。スーツを出した、すぐ着ろ。'],
  hachi_air_danger: ['船内は{p}キロパスカルしかない、もう危険域だ。スーツを着ろ、今すぐ。'],
  hachi_air_suited: ['気圧はあと{t}で危険域だが、スーツがあれば大丈夫だ。穴をふさぐぞ。'],
  hachi_pattern: ['{id}はまた同じ角度から来る。パターンは読めた。射撃精度を上げる。解析{pct}パーセント。', '奴らの攻撃は型通りだ。読みは{pct}パーセント。照準を詰める。'],
  hachi_incoming: ['{id}、{dir}から突っ込んでくる。あと{t}秒で射程。', '{dir}、{id}が攻撃航過に入った。{t}秒後に撃ってくる。'],
  hachi_jink: ['撃ってくる。横に跳ぶぞ、つかまれ。', '射線から外す。揺れるぞ。'],
  hachi_split: ['{a}は私がやる。アスファルト、{b}を頼む。', '目標を分ける。私は{a}、B-29は{b}だ。'],
  hachi_fuel_plan: ['B-29まで{d}。戻るのに推進剤が約{need}キロ要るが、残りは{kg}キロだ。そろそろ戻るか、迎えを呼べ。'],
  hachi_triage: ['船外の応急処置は{n}件。まず{a}、次に{b}だ。'],
  hachi_relay_hit: ['アスファルトから連絡。B-29が損傷した。健全度{pct}パーセント。'],
  hachi_relay_air: ['アスファルトから連絡。B-29の{zone}の気圧が{kpa}キロパスカルまで下がっている。'],
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
        // HACHI: a different (lower, male if there is one) Japanese voice
        this.voiceH = vs.find((v) => /ja/i.test(v.lang) && /Otoya|Ichiro|Keita|Hattori|Daichi|Naoki|male/i.test(v.name)) || null;
      };
      pick();
      speechSynthesis.onvoiceschanged = pick;
    }
  }

  unlock() {
    if (!('speechSynthesis' in window)) return;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* ignore */ }
  }

  say(key, params = {}, { force = false, minGap = 20, who = 'asphalt' } = {}) {
    const arr = who === 'hachi' ? HACHI[key] : LINES[key];
    if (!arr) return;
    const now = performance.now() / 1000;
    if (!force && this.lastKey[key] && now - this.lastKey[key] < minGap) return;
    this.lastKey[key] = now;
    let text = arr[Math.floor(Math.random() * arr.length)];
    for (const [k, v] of Object.entries(params)) text = text.replaceAll('{' + k + '}', v);
    // server damage garbles the voice
    const sv = this.g.damage ? this.g.damage.health.servers : 1;
    if (sv < 0.5 && Math.random() < 0.6) text = text.replace(/(.)(.)/, '$1…$1$2');
    this.log.push({ t: this.g.time, text: who === 'hachi' ? 'HACHI: ' + text : text, key, who });
    if (this.log.length > 60) this.log.shift();
    this.queue.push({ text, who });
    this._next();
  }

  _next() {
    if (this.speaking || !this.queue.length) return;
    const { text, who } = this.queue.shift();
    const hachi = who === 'hachi';
    // HACHI announces itself with two short digital pips instead of Asphalt's chime
    if (hachi) { const A = this.g.audio; if (A.beep) { A.beep(1760, 0.05, 0.05, { direct: true }); A.beep(2350, 0.06, 0.05, { direct: true, when: 0.08 }); } }
    else this.g.audio.chime && this.g.audio.chime();
    if (!this.voiceOn || !('speechSynthesis' in window)) { this.speaking = true; setTimeout(() => { this.speaking = false; this._next(); }, 1800); return; }
    this.speaking = true;
    setTimeout(() => {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ja-JP';
        const v = hachi ? (this.voiceH || this.voice) : this.voice;
        if (v) u.voice = v;
        const sv = this.g.damage ? this.g.damage.health.servers : 1;
        u.rate = hachi ? 1.12 : sv < 0.5 ? 0.85 : 1.02;
        u.pitch = hachi ? (this.voiceH ? 0.85 : 0.55) : sv < 0.5 ? 0.7 : 1.08;
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
