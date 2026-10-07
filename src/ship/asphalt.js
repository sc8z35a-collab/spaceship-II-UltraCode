// "Asphalt" — B-29's onboard AI, and HACHI — H8's. They speak Japanese through speech synthesis
// (no on-screen subtitles) and keep a log for the monitors.
//
// Both say only what Kaito needs: danger that calls for him now, why something he asked for will
// not happen, and the answers to his own questions. Everything else — what they are doing,
// arrivals, the state of things — goes to the log on the screens without a word (and without the
// chime). The comms screen switches the voice between this (最小限, the default), everything
// (すべて, the old chatter) and off.
const LINES = {
  welcome: ['B-29、全システム正常。出発します。'],
  boot: ['B-29、全システム起動。'],
  back: ['{h}経過しました。'],
  offline_hits: ['留守中に{n}回衝突がありました。'],
  offline_quiet: ['留守中、異常はありませんでした。'],
  autopilot_on: ['{name}へ自動航行。'],
  ap_wreck: ['{name}は残骸です。ドッキングできません。'],
  ap_dark: ['{name}は機能停止中です。'],
  autopilot_off: ['自動操縦を解除。'],
  autopilot_fail: ['サーバー損傷。自動操縦できません。'],
  arrived: ['{name}に到着。'],
  docked: ['修理完了。'],
  ultra_air: ['大気中のULTRAは危険です。解除を。'],
  ultra_shudder: ['ULTRAの振動が強くなっています。'],
  ultra_damage: ['ULTRAの振動で{what}が損傷。'],
  buckle: ['外板が一枚曲がりました。'],
  danger1: ['船体損傷。健全度{pct}%。'],
  danger2: ['船体が危険です。健全度{pct}%。'],
  danger2_air: ['気圧{kpa}キロパスカル。安全な区画へ。'],
  danger3: ['船体が限界です。'],
  breakup: ['船体が…もちません…！'],
  w_hit: ['{name}に隕石。被害は軽微。'],
  w_hit_big: ['{name}に小惑星が衝突。'],
  w_hit_el: ['エレベーターのリボンに衝突。'],
  w_damaged: ['{name}が損傷。'],
  w_critical: ['{name}が危険な状態です。'],
  w_failed: ['{name}が全停止。'],
  w_destroyed: ['{name}が崩壊しました。'],
  w_damaged_el: ['宇宙エレベーター損傷。'],
  w_critical_el: ['宇宙エレベーターが危険な状態。'],
  w_failed_el: ['宇宙エレベーター停止。'],
  w_destroyed_el: ['エレベーターのリボンが切れました。'],
  w_secondary: ['{name}で二次爆発。'],
  w_pods: ['{name}から脱出ポッド。'],
  w_debris: ['破片が当たっています。離れてください。'],
  w_berth_dark: ['ステーション側の電源が落ちました。'],
  st_dock_start: ['{name}へドッキング開始。'],
  st_docked: ['{name}にドッキング。'],
  st_docked_g: ['{name}にドッキング。重力0.9G。'],
  st_dock_abort: ['ドッキング中止。'],
  st_dock_retry: ['接触。下がってやり直します。'],
  el_climber_up: ['{line}のクライマー{id}が到着します。'],
  el_climber_down: ['{line}のクライマー{id}が到着します。'],
  st_undock: ['{name}から離脱。'],
  st_undocked: ['離脱完了。'],
  st_dock_hatch: ['外側ハッチが閉まりません。'],
  st_hatch_auto: ['外側ハッチを閉めて離脱します。'],
  st_undock_go: ['離脱して{name}へ向かいます。'],
  st_dock_crew: ['まだステーション内にいます。'],
  st_dock_far: ['近くにドッキング先がありません。'],
  st_dock_ultra: ['ULTRA中はドッキングできません。'],
  st_docked_ultra: ['ドッキング中はULTRAを使えません。'],
  st_docked_ap: ['ドッキング中です。先に離脱を。'],
  st_hit: ['{name}に接触。'],
  fracture: ['{zone}の壁に亀裂。'],
  ring_arrive: ['リング居住区。{g}G。'],
  ring_leave: ['ハブに戻りました。'],
  ring_dark: ['エレベーター停止中。はしごを使います。'],
  st_breach: ['{name}の{sec}で減圧。'],
  st_breach_here: ['この区画が減圧中。退避を。'],
  st_sealed: ['区画は閉鎖されています。扉を開けないで。'],
  st_air_ok: ['{sec}の気圧回復。'],
  st_port_low: ['ロビー側の気圧低下。ハッチを閉めて。'],
  st_gone: ['ステーション崩壊。すぐ船へ！'],
  st_gone_suit: ['ステーション崩壊。船へ戻って。'],
  ultra_on: ['ULTRA点火。'],
  ultra_safety: ['船体強度{pct}%。ULTRAを止めます。'],
  ultra_risky: ['船体が弱っています。責任は持てません。'],
  ultra_off: ['ULTRA解除。'],
  ultra_denied: ['エンジン損傷。ULTRAは使えません。'],
  impact_micro: ['微小衝突。'],
  impact: ['衝突。損傷あり。'],
  impact_big: ['大きな衝突。損傷あり。'],
  breach: ['{zone}で空気漏れ。'],
  breach_big: ['{zone}で急減圧。隔壁閉鎖。'],
  window_crack: ['{zone}の窓にひび。'],
  window_broken: ['窓が割れました。{zone}が減圧中。'],
  pipe: ['{sys}の配管漏れ。{where}。'],
  equip: ['{what}に異常。'],
  worse: ['{what}の損傷が進行。'],
  o2_low: ['酸素が低下しています。'],
  co2_high: ['二酸化炭素が高濃度です。'],
  pressure_low: ['気圧が危険です。安全な区画へ。'],
  asteroid: ['衝突コース。{dir}、{km}キロ。'],
  asteroid_miss: ['物体が{dir}を通過。'],
  evaded: ['回避成功。'],
  coffee: ['コーヒーですね。'],
  coffee_zero_g: ['パウチに入れました。'],
  shower: ['お湯は38度です。'],
  shower_zero_g: ['無重力シャワーです。'],
  repair_ok: ['修理完了。'],
  repair_patch: ['応急処置済み。悪化に注意。'],
  repair_cannot: ['ここでは直せません。修理基地へ。'],
  kit_empty: ['資材が足りません。'],
  need_kit: ['修理キットが必要です。'],
  reentry: ['大気圏突入。'],
  reentry_hot: ['船体温度が限界です。減速を。'],
  reentry_burn: ['船体が燃えています。'],
  landing: ['着地。'],
  splash: ['着水。'],
  crash: ['衝撃に備えて！'],
  ground_hit: ['地表に接触。損傷あり。'],
  terrain_warn: ['地表が近い。上昇を。'],
  gravity: ['重力を検知。'],
  suit_on: ['宇宙服装着。'],
  suit_off: ['宇宙服を脱ぎました。'],
  eva_out: ['船外です。'],
  eva_far: ['船から{m}メートル。'],
  eva_o2: ['宇宙服の酸素が残りわずかです。'],
  airlock_dep: ['エアロック減圧。'],
  airlock_rep: ['エアロック加圧。'],
  airlock_ready: ['減圧完了。'],
  hatch_nosuit: ['宇宙服がないと開けられません。'],
  hatch_press: ['先にエアロックを減圧してください。'],
  door_pressure: ['気圧差があり開きません。'],
  door_jammed: ['扉が変形して動きません。'],
  silenced: ['警報を消音。'],
  lockdown: ['隔壁閉鎖。'],
  sleep: ['おやすみなさい。'],
  wake: ['{h}眠っていました。'],
  idle: [
    '今日も地球はきれいですね。',
    '軌道上では、90分ごとに日の出が来ます。',
    '5G中継局の信号、良好です。',
    '宇宙は静かですね。',
    '原子炉、出力安定。',
  ],
  sunrise: ['日の出です。'],
  dying: ['カイト…応答してください…'],
  low_power: ['電力不足。不要な系統を切ります。'],
  reactor_hot: ['原子炉が過熱しています。'],
  comms_lost: ['5G回線断。'],
  sleep_denied: ['警報中は眠れません。'],
  saved: ['保存しました。'],
  repress: ['再加圧します。'],
  water_in: ['海の中です。'],
  eva_back: ['船内に戻りました。'],
  fuel_low: ['推進剤が残り少ないです。'],
  liftoff: ['離陸。'],
  dock_far: ['修理ドックの位置にいません。'],
  hurt: ['カイト、大丈夫ですか！？'],
  eva_impact: ['危ない、すぐ近くに衝突！'],
  breach_patched: ['穴をふさぎました。'],
  // H8 (Kaito's old sub-base) — Asphalt's side
  h8_call: ['H8に呼びかけ。距離{d}。'],
  h8_docked: ['H8結合。'],
  h8_undocked: ['H8離脱。'],
  h8_port_none: ['H8が結合していません。'],
  h8_link_down: ['H8と通信できません。'],
  h8_zap_thanks: ['HACHIが撃ち落としました。'],
  h8_hint: ['H8はナビ画面の左上から呼べます。'],
  h8_out_of_range: ['H8は圏外です。{d}。'],
  h8_no_fuel: ['H8の推進剤が足りません。'],
  h8_link_up: ['H8と通信回復。{d}。'],
  h8_link_lost: ['H8と通信断。{d}。'],
  h8_called: ['H8へ向かいます。{d}。'],
  h8_called_undock: ['離脱してからH8へ向かいます。'],
  h8_lost: ['H8の反応が消えました…'],
  pod_rescue: ['シェルターを回収しました。カイト、おかえりなさい。'],
  pod_station: ['B-29は{why}動けません。{name}に救助を要請しました。救助艇が向かっています。到着まで約{eta}。'],
  pod_station_capture: ['{name}の救助艇がシェルターを確保しました。'],
  pod_station_done: ['救助完了。B-29も{name}に曳航され、係留されました。カイト、おかえりなさい。'],
  pod_nobody: ['救助を出せるステーションがありません…酸素を節約してください。'],
  pod_go: ['シェルターの回収に向かいます。{d}。'],
  h8_lost_pod: ['H8の反応が消えました…でも、シェルターのビーコンは生きています！'],
  h8_rebuilt: ['修理基地でH8を造り直しました。上で待機しています。'],
  pod_coming: ['シェルターへ向かいます。{d}。'],
  b29_report: ['B-29、{state}。推進剤{fuel}%、船体{integ}%、電力{pw}%。'],
  ultra_nofuel: ['推進剤不足。ULTRAは使えません。'],
  fuel_out: ['推進剤切れ。予備スラスターに切替。'],
  b29_fuel_low: ['推進剤残り{pct}%。'],
  b29_refuel: ['推進剤を補給中。'],
  b29_refueled: ['推進剤満タン。'],
  origin_supply: ['オリジンから補給を受けています。'],
  origin_done: ['補給完了。'],
  // the hunter drones and B-29's defence gun
  drones_contact: ['無人機{n}機、接近中。'],
  enemy_near: ['敵が来ました。'],
  hit_shot: ['被弾。'],
  drone_down: ['無人機撃墜。残り{left}機。'],
  pd_auto_on: ['防衛機銃、自動。'],
  pd_auto_off: ['防衛機銃、手動。'],
  pd_ammo_out: ['防衛機銃、弾切れです。'],
  w_shot: ['{name}に命中しています。撃たないで。'],
  b29_rearm: ['弾薬を補給しました。'],
  origin_supply: ['オリジンの自動補給システムと接続。電力、推進剤、空気、水、食料、修理部材を補給します。'],
  origin_supply_done: ['補給完了。すべて満載です。'],
  food_low: ['食料が残り{d}日分です。オリジン国際宇宙ステーションで補給できます。'],
  food_out: ['食料が尽きました。オリジンで補給してください。'],
  asp_relay_h8: ['H8被弾。外部装甲{pct}%。'],
  asp_split: ['{b}は私が撃ちます。'],
  h8_leak_port: ['H8から空気が漏れています。ハッチを閉めて。'],
  photo_saved: ['写真を保存しました。'],
};

// HACHI — H8's AI: terse, dry, very sure of itself
const HACHI = {
  hachi_wake: ['HACHI起動。距離{d}、向かう。'],
  hachi_coming: ['B-29へ向かう。{d}。'],
  hachi_meet: ['ここからは私がやる。'],
  hachi_final: ['最終進入。'],
  hachi_docked: ['結合完了。'],
  hachi_reply: ['アスファルト、相変わらずだな。'],
  hachi_undock: ['離脱する。'],
  hachi_undock_crew: ['離脱。操縦は任せる。'],
  hachi_manual: ['操縦を渡す。'],
  hachi_home: ['停泊軌道へ戻る。'],
  hachi_parked: ['停泊。省電力。'],
  hachi_arrived: ['{name}に到着。'],
  hachi_touchdown: ['着地。'],
  hachi_splash: ['着水。'],
  hachi_berth_go: ['{name}へ向かい、そのままドッキングする。'],
  hachi_berthed: ['{name}に係留。電力と推進剤を受け取る。'],
  hachi_unberth: ['{name}から離脱。'],
  hachi_dock_dead: ['{name}は応答がない。ドッキングできない。'],
  hachi_goto: ['{name}へ向かう。'],
  hachi_ultra_on: ['ULTRA。最高{v}。'],
  hachi_max_on: ['MAX。最高{v}。蓄電は長くもたない。'],
  hachi_drive_normal: ['通常推進に戻す。'],
  hachi_drive_power: ['蓄電が尽きる。{mode}を落とした。'],
  hachi_drive_denied: ['出せない。{why}。'],
  hachi_goto_far: ['{name}は遠すぎる。'],
  hachi_goto_no: ['{name}へは行けない。'],
  hachi_hatch_closing: ['ハッチを閉める。'],
  hachi_vestibule: ['ハッチの間に人がいる。'],
  hachi_busy: ['B-29がドッキング中だ。'],
  hachi_feed_on: ['給電を受ける。'],
  hachi_feed_off: ['給電を切った。'],
  hachi_boost_on: ['ブースト許可。'],
  hachi_boost_off: ['ブースト解除。'],
  hachi_ultra_on: ['ULTRA。電力の減りが早いぞ。'],
  hachi_ultra_off: ['ULTRA解除。'],
  hachi_max_on: ['MAX。蓄電は長くもたない。'],
  hachi_max_off: ['MAX解除。'],
  hachi_power_out: ['蓄電が尽きる。ULTRAを切る。'],
  hachi_zap: ['岩塊を除去。'],
  hachi_big_rock: ['大きい岩だ。回避する。'],
  hachi_rock: ['岩塊接近。回避する。'],
  hachi_rock_small: ['小石を迎撃する。'],
  hachi_hit: ['被弾。外部装甲{pct}%。'],
  hachi_hit_hard: ['被弾。外部装甲{pct}%。'],
  hachi_leak: ['内部装甲を抜かれた。減圧する。'],
  hachi_bump: ['接触した。'],
  hachi_enter: ['ようこそ、カイト。'],
  hachi_no_link: ['B-29と通信できない。'],
  hachi_b29_landed: ['B-29は地上だ。'],
  hachi_b29_coming: ['B-29はもう向かっている。{d}。'],
  hachi_b29_nofuel: ['B-29の推進剤が足りない。'],
  hachi_call_b29: ['B-29を呼んだ。{d}。'],
  hachi_report: ['H8、{state}。推進剤{fuel}%、装甲{arm}%、蓄電{smes}%。'],
  hachi_fuel_low: ['推進剤{pct}%。'],
  hachi_fuel_out: ['推進剤切れだ。'],
  hachi_xfer_b29: ['推進剤をB-29へ送る。'],
  hachi_xfer_h8: ['B-29から推進剤をもらう。'],
  hachi_xfer_stop: ['移送停止。'],
  hachi_cam_lost: ['{cam}が死んだ。その方向は映らない。'],
  hachi_hole: ['外部装甲に穴。{pct}%。'],
  hachi_drones_contact: ['敵無人機{n}機。'],
  hachi_drone_hit: ['{id}に命中。'],
  hachi_drone_down: ['{id}撃墜。残り{left}。'],
  hachi_drone_down_station: ['ステーションが{id}を撃墜。'],
  hachi_drone_dry: ['{id}が弾切れで離脱。'],
  hachi_drones_clear: ['敵影なし。'],
  hachi_enemy_near: ['敵が来ました。'],
  hachi_low_auto: ['弾薬の生産が追いつかない。エンジンをLOWに。電力は弾薬生産へ回す。'],
  hachi_low_cut: ['弾薬の生産が追いつかない。{mode}を切ってLOWに。電力は弾薬生産へ回す。'],
  hachi_low_again: ['まだ弾薬が足りない。もう一度LOWに。電力も弾薬生産へ。'],
  hachi_ammo_pri: ['弾薬の生産が追いつかない。電力を弾薬生産へ回す。'],
  hachi_low_restore: ['敵影なし。エンジンを{mode}に戻す。'],
  hachi_ammo_normal: ['敵影なし。弾薬生産は通常に戻す。'],
  hachi_low_off_ack: ['LOW解除。弾薬生産も通常に。1分たってまだ足りなければ、またLOWにする。'],
  hachi_drive_low: ['LOW。推力を絞る。'],
  hachi_pri_on: ['弾薬生産を優先。'],
  hachi_pri_off: ['弾薬生産を通常に。'],
  hachi_msl: ['ミサイル、{name}へ。'],
  hachi_msl_reload: ['再装填中。'],
  hachi_msl_wait: ['{name}が射程に入ったら撃つ。'],
  hachi_msl_lost: ['ミサイルが撃ち落とされた。'],
  hachi_made_msl: ['ミサイル完成。{n}発。'],
  hachi_rock_kill: ['岩を砕いた。'],
  hachi_auto_on: ['自動迎撃。50 km圏内の一番近い敵を撃つ。'],
  hachi_auto_off: ['自動迎撃を切った。'],
  hachi_ammo_out: ['弾切れだ。'],
  hachi_rail_charging: ['レールガン充電中。{pct}%。'],
  hachi_no_target: ['目標がない。'],
  hachi_out_of_range: ['射程外だ。{d}。'],
  hachi_rail_blocked: ['その方向は撃てない。'],
  hachi_friendly: ['射線に味方がいる。撃てない。'],
  hachi_salvo: ['ミサイル{n}発。'],
  hachi_suit_out: ['スーツを出す。'],
  hachi_suit_on: ['スーツ接続。'],
  hachi_suit_off: ['スーツ収納。'],
  hachi_suit_keep: ['気圧が低い。脱ぐな。'],
  hachi_follow_on: ['{name}を追従。'],
  hachi_follow_off: ['追従解除。'],
  hachi_follow_none: ['追従する目標がない。'],
  hachi_follow_lost: ['追従目標を見失った。'],
  hachi_scramble_near: ['B-29の援護に入る。'],
  hachi_scramble: ['B-29の援護に向かう。{d}。'],
  // outside work: the suit, the airlock in the shaft and the field repairs
  hachi_eva_out: ['船外だ。修理箇所はバイザーに出す。'],
  hachi_eva_back: ['戻ったな。'],
  hachi_eva_nosuit: ['スーツが要る。'],
  hachi_eva_hold: ['船外作業中。位置を保持する。'],
  hachi_kit_empty: ['{what}がない。'],
  hachi_fix_hole: ['{name}をふさぐ。'],
  hachi_fix_cam: ['{name}をつなぎ直す。'],
  hachi_fix_circuit: ['{name}をバイパスする。'],
  hachi_fixed_hole: ['穴はふさがった。'],
  hachi_fixed: ['{name}、仮復旧。'],
  hachi_lock_dep: ['シャフト減圧。'],
  hachi_lock_rep: ['シャフト再加圧。'],
  hachi_lock_open: ['外ハッチ開。'],
  hachi_lock_closed: ['再加圧完了。'],
  hachi_hatch_pressure: ['気圧差がある。開けられない。'],
  hachi_guide: ['{name}まで{m}メートル。'],
  hachi_circuit: ['{name}がやられた。'],
  // the shelter at the back of the cockpit
  hachi_shelter_open: ['シェルターを開ける。'],
  hachi_shelter_seal: ['シェルター密閉。独立酸素に切り替えた。'],
  hachi_shelter_go: ['シェルターに入れ、カイト。'],
  hachi_shelter_o2: ['シェルターの酸素、残り{t}。'],
  hachi_breakup: ['H8がもたない…！'],
  hachi_pod: ['H8を失った。シェルターだけ残った。酸素は{t}。'],
  hachi_pod_vacuum: ['外は真空だ。出られない。'],
  // HACHI's mind: the air, the drones, the order of repairs, B-29 over the link, questions
  hachi_free: ['{text}'],
  hachi_port_leak: ['B-29の空気まで抜けている。ハッチを閉めろ。'],
  hachi_port_seal: ['H8側のハッチを閉めた。'],
  hachi_air_suit: ['減圧中。あと{t}で危険域。スーツを着ろ。'],
  hachi_air_danger: ['船内{p}キロパスカル。スーツを着ろ。'],
  hachi_air_suited: ['あと{t}で危険域だ。'],
  hachi_pattern: ['攻撃パターン解析{pct}%。'],
  hachi_incoming: ['{id}、{dir}から突入。{t}秒。'],
  hachi_jink: ['回避する。'],
  hachi_split: ['{a}は私、{b}はB-29だ。'],
  hachi_fuel_plan: ['B-29まで{d}。推進剤が足りなくなる。'],
  hachi_triage: ['応急処置{n}件。まず{a}。'],
  hachi_relay_hit: ['B-29損傷。健全度{pct}%。'],
  hachi_relay_air: ['B-29の{zone}が{kpa}キロパスカル。'],
};

// What is said aloud in the default mode (最小限): danger Kaito must act on now, refusals (why
// what he asked for will not happen) and the answers to his questions. The rest is log only.
const VOICE = new Set([
  // danger
  'breach', 'breach_big', 'window_broken', 'pressure_low', 'o2_low', 'co2_high', 'danger3', 'reentry_hot', 'reentry_burn',
  'breakup', 'dying', 'crash', 'impact_big', 'asteroid', 'drones_contact', 'eva_o2', 'st_breach_here', 'st_gone', 'st_gone_suit',
  'w_debris', 'ultra_safety', 'fuel_out', 'reactor_hot', 'eva_impact', 'h8_leak_port', 'terrain_warn', 'h8_lost', 'pod_rescue', 'h8_lost_pod',
  'pod_station', 'pod_station_capture', 'pod_station_done', 'pod_nobody',
  'food_out',
  // refusals
  'autopilot_fail', 'ap_wreck', 'ap_dark', 'st_dock_far', 'st_dock_ultra', 'st_docked_ultra', 'st_docked_ap', 'st_dock_hatch',
  'st_dock_crew', 'ultra_denied', 'ultra_nofuel', 'need_kit', 'kit_empty', 'repair_cannot', 'hatch_nosuit', 'hatch_press',
  'door_pressure', 'door_jammed', 'sleep_denied', 'dock_far', 'h8_out_of_range', 'h8_no_fuel', 'h8_port_none', 'h8_link_down',
  // asked
  'b29_report',
  // HACHI: danger
  'hachi_leak', 'hachi_air_danger', 'hachi_air_suit', 'hachi_fuel_out', 'hachi_port_leak', 'hachi_drones_contact',
  'enemy_near', 'hachi_enemy_near', 'hachi_low_auto', 'hachi_low_cut', 'hachi_low_again', 'hachi_ammo_pri', 'hachi_low_restore',
  'hachi_low_off_ack',
  'hachi_power_out', 'hachi_shelter_go', 'hachi_breakup', 'hachi_shelter_o2', 'hachi_pod', 'hachi_pod_vacuum',
  // HACHI: refusals
  'hachi_no_link', 'hachi_vestibule', 'hachi_busy', 'hachi_eva_nosuit', 'hachi_suit_keep', 'hachi_no_target', 'hachi_rail_blocked',
  'hachi_hatch_pressure', 'hachi_follow_none', 'hachi_b29_nofuel', 'hachi_b29_landed', 'hachi_kit_empty', 'hachi_ammo_out',
  'hachi_out_of_range', 'hachi_friendly', 'hachi_goto_far', 'hachi_goto_no', 'hachi_drive_denied', 'hachi_drive_power', 'hachi_dock_dead',
  // HACHI: asked
  'hachi_free', 'hachi_report',
]);

const MODES = ['min', 'all', 'off'];
export const VOICE_JP = { min: '最小限', all: 'すべて', off: 'OFF' };

export class Asphalt {
  constructor(game) {
    this.g = game;
    this.log = [];
    this.queue = [];
    this.speaking = false;
    this.voice = null;
    let m = 'min';
    try { m = localStorage.getItem('b29.voice') || 'min'; } catch (e) { /* storage off */ }
    this.mode = MODES.includes(m) ? m : 'min';
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

  /** the voice on at all (some screens show it as ON / OFF) */
  get voiceOn() { return this.mode !== 'off'; }

  /** 最小限 -> すべて -> OFF -> 最小限 */
  cycleMode() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    try { localStorage.setItem('b29.voice', this.mode); } catch (e) { /* storage off */ }
    if (this.mode === 'off' && 'speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } this.queue.length = 0; }
    return this.mode;
  }

  unlock() {
    if (!('speechSynthesis' in window)) return;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* ignore */ }
  }

  /** would this line be spoken (rather than only logged) */
  spoken(key) { return this.mode === 'all' || (this.mode === 'min' && VOICE.has(key)); }

  say(key, params = {}, { force = false, minGap = 20, who = 'asphalt' } = {}) {
    const arr = who === 'hachi' ? HACHI[key] : LINES[key];
    if (!arr) return;
    const now = performance.now() / 1000;
    if (!force && this.lastKey[key] && now - this.lastKey[key] < minGap) return;
    // the same line over and over (a burst of hits) is one entry and one word
    const prev = this.log[this.log.length - 1];
    const repeat = prev && prev.key === key && this.g.time - prev.t < 4000;
    this.lastKey[key] = now;
    let text = arr[Math.floor(Math.random() * arr.length)];
    for (const [k, v] of Object.entries(params)) text = text.replaceAll('{' + k + '}', v);
    // server damage garbles the voice
    const sv = this.g.damage ? this.g.damage.health.servers : 1;
    if (sv < 0.5 && Math.random() < 0.6) text = text.replace(/(.)(.)/, '$1…$1$2');
    const entry = { t: this.g.time, text: who === 'hachi' ? 'HACHI: ' + text : text, key, who, spoken: this.spoken(key) };
    if (repeat) { prev.t = entry.t; prev.text = entry.text; prev.n = (prev.n || 1) + 1; return; }
    this.log.push(entry);
    if (this.log.length > 80) this.log.shift();
    if (!entry.spoken) return;
    // (one word at a time: a danger line waiting behind chatter would come too late)
    if (this.queue.length > 2) this.queue.splice(0, this.queue.length - 2);
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
    if (!this.voiceOn || !('speechSynthesis' in window)) { this.speaking = true; setTimeout(() => { this.speaking = false; this._next(); }, 1200); return; }
    this.speaking = true;
    setTimeout(() => {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ja-JP';
        const v = hachi ? (this.voiceH || this.voice) : this.voice;
        if (v) u.voice = v;
        const sv = this.g.damage ? this.g.damage.health.servers : 1;
        u.rate = hachi ? 1.15 : sv < 0.5 ? 0.88 : 1.08;
        u.pitch = hachi ? (this.voiceH ? 0.85 : 0.55) : sv < 0.5 ? 0.7 : 1.08;
        u.volume = 0.9;
        u.onend = u.onerror = () => { this.speaking = false; setTimeout(() => this._next(), 200); };
        speechSynthesis.speak(u);
        // safety timeout
        setTimeout(() => { if (this.speaking) { this.speaking = false; this._next(); } }, 12000);
      } catch (e) { this.speaking = false; }
    }, 300);
  }

  update(dt, calm) {
    // idle chatter only when everything is to be said
    if (!calm || this.mode !== 'all') { this.idleT = Math.max(this.idleT, 120); return; }
    this.idleT -= dt;
    if (this.idleT <= 0) {
      this.idleT = 420 + Math.random() * 600;
      this.say('idle', {}, { minGap: 300 });
    }
  }
}
