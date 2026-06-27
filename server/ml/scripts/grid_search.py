#!/usr/bin/env python3
"""
Phase 6.3 / 6.4b — 集成权重网格搜索 + 校准评估
=============================================
离线运行，产出推荐参数和校准报告。

用法:
  cd server/ml
  python scripts/grid_search.py [--quick]

输出:
  - 推荐参数组合 (stdout)
  - Top-N 参数表
  - 校准可靠性报告 (可选 ECE)
"""

import os, sys, json, argparse
from itertools import product
import numpy as np

# 项目路径
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ML_DIR = os.path.dirname(SCRIPT_DIR)  # server/ml/
DATA_DIR = os.path.join(ML_DIR, 'data')
MODELS_DIR = os.path.join(ML_DIR, 'models')
TRAINING_DATA = os.path.join(DATA_DIR, 'training_data.csv')

sys.path.insert(0, ML_DIR)
from inference.predict import predict, load_models, FEATURE_COLUMNS

# ── 配置 ──────────────────────────────────────────────────

GRID = {
    'ml_weight': [0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80],
    'confidence_threshold': [0.50, 0.52, 0.54, 0.56, 0.58, 0.60, 0.62, 0.64, 0.66, 0.68, 0.70],
    'disagreement_threshold': [0.10, 0.12, 0.14, 0.16, 0.18, 0.20, 0.22, 0.24, 0.26, 0.28, 0.30],
}
MIN_ML_WEIGHT = 0.4
MAX_ML_WEIGHT = 0.8


def load_training_data():
    """加载训练数据（含实际结果）"""
    import pandas as pd
    if not os.path.exists(TRAINING_DATA):
        print(f"[WARN] 训练数据不存在: {TRAINING_DATA}", file=sys.stderr)
        return None
    df = pd.read_csv(TRAINING_DATA)
    required = ['home_team', 'away_team', 'home_goals', 'away_goals', 'result']
    missing = [c for c in required if c not in df.columns]
    if missing:
        print(f"[WARN] 缺少列: {missing}", file=sys.stderr)
        return None
    print(f"[INFO] 加载 {len(df)} 条历史比赛数据", file=sys.stderr)
    return df


def compute_ece(probabilities, outcomes, n_bins=10):
    """Expected Calibration Error (ECE)"""
    bins = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    for i in range(n_bins):
        mask = (probabilities >= bins[i]) & (probabilities < bins[i + 1])
        if np.sum(mask) == 0:
            continue
        bin_conf = np.mean(probabilities[mask])
        bin_acc = np.mean(outcomes[mask])
        ece += np.sum(mask) * abs(bin_conf - bin_acc)
    return ece / len(probabilities)


def log_loss(y_true, y_pred_probs, eps=1e-15):
    y_pred_probs = np.clip(y_pred_probs, eps, 1 - eps)
    return -np.mean(y_true * np.log(y_pred_probs) + (1 - y_true) * np.log(1 - y_pred_probs))


def brier_score(y_true, y_pred_probs):
    return np.mean((y_true - y_pred_probs) ** 2)


def simulate_ensemble(elo_prob, ml_prob, ml_weight, confidence, conf_thresh, dis_thresh):
    """Apply dynamic ensemble blending, return blended probabilities and metadata."""
    w_ml = ml_weight
    w_elo = 1 - ml_weight

    # Dynamic weight adjustment
    prob_gap = max(
        abs(elo_prob[h] - ml_prob[h]) for h in ['homeWin', 'draw', 'awayWin']
    )
    adjusted = False
    if confidence < conf_thresh or prob_gap > dis_thresh:
        w_ml = max(MIN_ML_WEIGHT, min(w_ml, MAX_ML_WEIGHT))
        w_elo = 1 - w_ml
        adjusted = True

    blended = {
        k: w_elo * elo_prob[k] + w_ml * ml_prob[k]
        for k in ['homeWin', 'draw', 'awayWin']
    }
    total = sum(blended.values())
    if total > 0:
        blended = {k: v / total for k, v in blended.items()}

    return blended, {'adjusted': adjusted, 'w_ml': w_ml, 'w_elo': w_elo}


def run_grid_search(models, df, quick=False):
    """Run full grid search over all parameter combinations."""
    from inference.predict import predict as ml_predict

    records = []
    matches = df.sample(min(500, len(df)), random_state=42) if quick else df

    for idx, row in matches.iterrows():
        features = {col: row.get(col, 0.0) for col in FEATURE_COLUMNS}
        ml_result = predict(features, models)
        # Simulated Elo: use a simple rating-based approximation
        # For backtesting, we use the actual results as target
        actual_home = row['home_goals']
        actual_away = row['away_goals']
        if actual_home > actual_away:
            actual_1x2 = [1, 0, 0]  # homeWin
        elif actual_home == actual_away:
            actual_1x2 = [0, 1, 0]  # draw
        else:
            actual_1x2 = [0, 0, 1]  # awayWin

        # Simulate Elo as ~default 50-50 with slight home bias
        elo_prob_sim = {'homeWin': 0.40, 'draw': 0.25, 'awayWin': 0.35}

        records.append({
            'ml_prob': ml_result['probabilities'],
            'ml_conf': ml_result.get('confidence', 0.5),
            'elo_prob': elo_prob_sim,
            'actual_1x2': actual_1x2,
            'actual_home': actual_home,
            'actual_away': actual_away,
        })

    print(f"[INFO] 加载 {len(records)} 条记录用于网格搜索", file=sys.stderr)

    results = []
    for ml_w, conf_th, dis_th in product(
        GRID['ml_weight'],
        GRID['confidence_threshold'],
        GRID['disagreement_threshold'],
    ):
        home_probs, draw_probs, away_probs = [], [], []
        home_actual, draw_actual, away_actual = [], [], []
        adj_count = 0

        for r in records:
            blended, meta = simulate_ensemble(
                r['elo_prob'], r['ml_prob'], ml_w,
                r['ml_conf'], conf_th, dis_th,
            )
            home_probs.append(blended['homeWin'])
            draw_probs.append(blended['draw'])
            away_probs.append(blended['awayWin'])
            home_actual.append(r['actual_1x2'][0])
            draw_actual.append(r['actual_1x2'][1])
            away_actual.append(r['actual_1x2'][2])
            if meta['adjusted']:
                adj_count += 1

        hp, dp, ap = np.array(home_probs), np.array(draw_probs), np.array(away_probs)
        ha, da, aa = np.array(home_actual), np.array(draw_actual), np.array(away_actual)

        # Log Loss
        losses = -(
            ha * np.log(np.clip(hp, 1e-15, 1)) +
            da * np.log(np.clip(dp, 1e-15, 1)) +
            aa * np.log(np.clip(ap, 1e-15, 1))
        )
        avg_ll = float(np.mean(losses))

        # Brier
        brier = float(np.mean((ha - hp)**2 + (da - dp)**2 + (aa - ap)**2))

        # ECE for homeWin
        ece_home = float(compute_ece(hp, ha))
        ece_draw = float(compute_ece(dp, da))
        ece_away = float(compute_ece(ap, aa))

        adjust_rate = adj_count / len(records) if records else 0

        results.append({
            'ml_weight': ml_w,
            'confidence_threshold': conf_th,
            'disagreement_threshold': dis_th,
            'log_loss': round(avg_ll, 5),
            'brier': round(brier, 5),
            'ece_home': round(ece_home, 5),
            'ece_draw': round(ece_draw, 5),
            'ece_away': round(ece_away, 5),
            'adjust_rate': round(adjust_rate, 4),
        })

    return results


def print_results(results, top_n=10):
    """Print top-N results sorted by log_loss."""
    sorted_results = sorted(results, key=lambda r: r['log_loss'])

    print("\n" + "=" * 90)
    print(f"  Top-{top_n} 参数组合 (按 Log Loss 升序)")
    print("=" * 90)
    print(f"{'Rank':>4} | {'ML权重':>7} | {'置信度阈值':>10} | {'分歧阈值':>10} | {'Log Loss':>9} | {'Brier':>7} | {'ECE_h':>6} | {'ECE_d':>6} | {'ECE_a':>6} | {'调整率':>8}")
    print("-" * 90)

    for i, r in enumerate(sorted_results[:top_n]):
        print(f"{i+1:>4} | {r['ml_weight']*100:>5.0f}% | {r['confidence_threshold']*100:>8.0f}% | {r['disagreement_threshold']*100:>8.0f}% | {r['log_loss']:>9.5f} | {r['brier']:>7.5f} | {r['ece_home']:>6.4f} | {r['ece_draw']:>6.4f} | {r['ece_away']:>6.4f} | {r['adjust_rate']*100:>6.1f}%")

    # Print current defaults
    print("\n--- 当前默认参数对照 ---")
    current = [r for r in results if abs(r['ml_weight'] - 0.70) < 0.01 and
               abs(r['confidence_threshold'] - 0.58) < 0.01 and
               abs(r['disagreement_threshold'] - 0.22) < 0.01]
    if current:
        c = current[0]
        print(f"  ML权重=70%   置信度阈=58%   分歧阈=22%  →  LL={c['log_loss']:.5f}  Brier={c['brier']:.5f}")

    # Recommended config
    best = sorted_results[0]
    print("\n--- 推荐线上参数 ---")
    print(f"  ml_weight = {best['ml_weight']:.2f}     # {best['ml_weight']*100:.0f}%")
    print(f"  confidenceThreshold = {best['confidence_threshold']:.2f}  # {best['confidence_threshold']*100:.0f}%")
    print(f"  disagreementThreshold = {best['disagreement_threshold']:.2f}  # {best['disagreement_threshold']*100:.0f}%")
    print(f"  预期目标: Log Loss={best['log_loss']:.5f}  Brier={best['brier']:.5f}")
    print(f"  调整率: {best['adjust_rate']*100:.1f}% ({adj_rate_to_str(best['adjust_rate'])})\n")

    # Fallback parameters
    print("--- 保底参数（回滚用） ---")
    fallback = [r for r in sorted_results if r['adjust_rate'] < 0.1][:1]
    if fallback:
        f = fallback[0]
        print(f"  ml_weight = {f['ml_weight']:.2f}")
        print(f"  confidenceThreshold = {f['confidence_threshold']:.2f}")
        print(f"  disagreementThreshold = {f['disagreement_threshold']:.2f}")


def adj_rate_to_str(rate):
    if rate < 0.05:
        return "几乎不动"
    elif rate < 0.15:
        return "偶发调整"
    elif rate < 0.3:
        return "稳定触发"
    else:
        return "频繁触发"


def compute_calibration_report(models, df):
    """Phase 6.4b: Compute ECE and reliability diagram for calibrated vs uncalibrated."""
    if df is None:
        print("[WARN] 无数据，跳过校准评估", file=sys.stderr)
        return

    from inference.predict import predict as ml_predict

    home_probs_raw, home_probs_cal = [], []
    home_outcomes = []

    sample = df.sample(min(500, len(df)), random_state=42)

    for _, row in sample.iterrows():
        features = {col: row.get(col, 0.0) for col in FEATURE_COLUMNS}

        # Raw rf_1x2
        raw_model = models.get('rf_1x2')
        if raw_model:
            from inference.predict import FEATURE_COLUMNS as FC
            X = np.array([[features.get(c, 0.0) for c in FC]], dtype=np.float32)
            raw_probs = raw_model.predict_proba(X)[0]
            raw_dict = dict(zip(raw_model.classes_, raw_probs))
            home_probs_raw.append(raw_dict.get('W', raw_dict.get(2, 0.0)))

        # Calibrated
        cal_model = models.get('rf_1x2_calibrated')
        if cal_model:
            from inference.predict import FEATURE_COLUMNS as FC
            X = np.array([[features.get(c, 0.0) for c in FC]], dtype=np.float32)
            cal_probs = cal_model.predict_proba(X)[0]
            cal_dict = dict(zip(cal_model.classes_, cal_probs))
            home_probs_cal.append(cal_dict.get('W', cal_dict.get(2, 0.0)))

        actual_goals = (row.get('home_goals', 0), row.get('away_goals', 0))
        home_outcomes.append(1 if actual_goals[0] > actual_goals[1] else 0)

    hp_raw = np.array(home_probs_raw)
    hp_cal = np.array(home_probs_cal)
    ho = np.array(home_outcomes)

    print("\n" + "=" * 60)
    print("  校准质量对比报告 (Phase 6.4b)")
    print("=" * 60)

    ece_raw = compute_ece(hp_raw, ho)
    ece_cal = compute_ece(hp_cal, ho)
    print(f"  ECE (raw):          {ece_raw:.5f}")
    print(f"  ECE (calibrated):   {ece_cal:.5f}")
    print(f"  改善:               {(ece_raw - ece_cal) / ece_raw * 100:+.1f}%" if ece_raw > 0 else "  N/A")

    # Log Loss for home
    ll_raw = log_loss(ho, hp_raw)
    ll_cal = log_loss(ho, hp_cal)
    print(f"  Log Loss (raw):     {ll_raw:.5f}")
    print(f"  Log Loss (cal):     {ll_cal:.5f}")

    # Brier
    b_raw = brier_score(ho, hp_raw)
    b_cal = brier_score(ho, hp_cal)
    print(f"  Brier (raw):        {b_raw:.5f}")
    print(f"  Brier (cal):        {b_cal:.5f}")
    print()


def main():
    parser = argparse.ArgumentParser(description='Phase 6 集成权重网格搜索')
    parser.add_argument('--quick', action='store_true', help='快速模式（小样本）')
    parser.add_argument('--skip-grid', action='store_true', help='跳过网格搜索，仅校准报告')
    parser.add_argument('--skip-cal', action='store_true', help='跳过校准评估')
    args = parser.parse_args()

    # 加载模型
    print("[INFO] 加载模型...", file=sys.stderr)
    models = load_models(MODELS_DIR)
    if not models:
        print("[ERROR] 模型加载失败", file=sys.stderr)
        sys.exit(1)

    # 加载数据
    df = load_training_data()

    if not args.skip_grid and df is not None:
        print(f"[INFO] 开始网格搜索 ({'快速' if args.quick else '完整'}模式)...", file=sys.stderr)
        results = run_grid_search(models, df, quick=args.quick)
        print_results(results, top_n=15)

        # 保存结果
        out_path = os.path.join(DATA_DIR, 'grid_search_results.json')
        with open(out_path, 'w') as f:
            json.dump(sorted(results, key=lambda r: r['log_loss']), f, ensure_ascii=False, indent=2)
        print(f"[INFO] 结果已保存: {out_path}", file=sys.stderr)

    if not args.skip_cal and df is not None:
        compute_calibration_report(models, df)
    else:
        print("[WARN] 跳过校准评估（无数据或 --skip-cal）", file=sys.stderr)


if __name__ == '__main__':
    main()
