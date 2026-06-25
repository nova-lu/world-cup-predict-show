"""
ML 模型推理脚本（Python 子进程）
接收特征 JSON → 加载模型 → 输出预测 JSON
"""
import sys
import json
import joblib
import numpy as np
import os

MODEL_DIR = os.path.join(os.path.dirname(__file__), '..', 'models', 'v1')

def load_models():
    return {
        'xgb_home': joblib.load(os.path.join(MODEL_DIR, 'xgb_home.pkl')),
        'xgb_away': joblib.load(os.path.join(MODEL_DIR, 'xgb_away.pkl')),
        'rf_1x2': joblib.load(os.path.join(MODEL_DIR, 'rf_1x2.pkl')),
        'xgb_btts': joblib.load(os.path.join(MODEL_DIR, 'xgb_btts.pkl')),
        'xgb_over_under': joblib.load(os.path.join(MODEL_DIR, 'xgb_over_under.pkl')),
    }

FEATURE_COLUMNS = [
    'team_rank', 'team_points', 'opponent_rank', 'opponent_points',
    'rank_diff', 'points_diff', 'is_home', 'is_host', 'is_knockout',
    'same_confed', 'host_points_diff', 'elo_rating_team', 'elo_rating_opponent',
    'elo_diff', 'team_recent_goals', 'opponent_recent_goals',
    'team_recent_conceded', 'opponent_recent_conceded',
    'team_recent_form', 'opponent_recent_form',
    'tournament_weight', 'days_since_last_match_team', 'days_since_last_match_opponent',
]

def predict(features_dict, models):
    """Run all models on a single feature vector"""
    # Build feature array in correct order, fill NaN with 0
    X_list = []
    for col in FEATURE_COLUMNS:
        val = features_dict.get(col)
        if val is None:
            val = 0.0
        X_list.append(val)
    X = np.array([X_list], dtype=np.float32)

    # 预期进球
    lambda_home = float(models['xgb_home'].predict(X)[0])
    lambda_away = float(models['xgb_away'].predict(X)[0])

    # 1X2 概率
    rf_probs = models['rf_1x2'].predict_proba(X)[0]
    probs_dict = dict(zip(models['rf_1x2'].classes_, rf_probs))

    # BTTS
    btts_proba = models['xgb_btts'].predict_proba(X)[0]
    btts_dict = dict(zip(models['xgb_btts'].classes_, btts_proba))

    # Over/Under 2.5
    ou_proba = models['xgb_over_under'].predict_proba(X)[0]
    ou_dict = dict(zip(models['xgb_over_under'].classes_, ou_proba))

    rf_sum = sum(probs_dict.values())
    return {
        'lambda_home': round(lambda_home, 3),
        'lambda_away': round(lambda_away, 3),
        'probabilities': {
            'homeWin': round(float(probs_dict.get('W', 0)) / rf_sum, 4) if rf_sum > 0 else 0.34,
            'draw': round(float(probs_dict.get('D', 0)) / rf_sum, 4) if rf_sum > 0 else 0.33,
            'awayWin': round(float(probs_dict.get('L', 0)) / rf_sum, 4) if rf_sum > 0 else 0.33,
        },
        'btts': {
            'yes': round(float(btts_dict.get(1, btts_dict.get('1', 0))), 4),
            'no': round(float(btts_dict.get(0, btts_dict.get('0', 0))), 4),
        },
        'over_under': {
            'over2_5': round(float(ou_dict.get(1, ou_dict.get('1', 0))), 4),
            'under2_5': round(float(ou_dict.get(0, ou_dict.get('0', 0))), 4),
        },
        'confidence': round(max(rf_probs), 4),
    }

def main():
    if len(sys.argv) < 1:
        print(json.dumps({'error': 'No input'}))
        return

    try:
        models = load_models()
    except Exception as e:
        print(json.dumps({'error': f'Failed to load models: {str(e)}'}))
        return

    input_str = sys.stdin.read().strip()
    if not input_str:
        print(json.dumps({'error': 'No input data'}))
        return

    try:
        inputs = json.loads(input_str)
    except json.JSONDecodeError:
        print(json.dumps({'error': 'Invalid JSON input'}))
        return

    if isinstance(inputs, dict):
        inputs = [inputs]

    results = []
    for feats in inputs:
        try:
            result = predict(feats, models)
            results.append(result)
        except Exception as e:
            results.append({'error': str(e)})

    print(json.dumps(results if len(results) > 1 else results[0]))

if __name__ == '__main__':
    main()
