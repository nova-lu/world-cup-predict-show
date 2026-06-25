"""
Football match prediction - ML training pipeline.
Trains XGBoost, Random Forest models for match outcome prediction.
"""

import os
import sys
import json
import warnings
import numpy as np
import pandas as pd
from datetime import datetime

# ML imports
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    mean_squared_error,
    mean_absolute_error,
    log_loss,
    accuracy_score,
    brier_score_loss,
    confusion_matrix,
)
from sklearn.preprocessing import LabelEncoder
import xgboost as xgb
import joblib

# Plotting
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

warnings.filterwarnings("ignore")

# ── Paths ──────────────────────────────────────────────────────────────────
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
FEATURES_CSV = os.path.join(PROJECT_ROOT, "data", "ml", "train", "v1", "features_full.csv")
MODELS_DIR = os.path.join(PROJECT_ROOT, "server", "ml", "models", "v1")
REPORTS_DIR = os.path.join(PROJECT_ROOT, "server", "ml", "training", "reports", "v1")
MANIFESTS_DIR = os.path.join(PROJECT_ROOT, "server", "ml", "manifests")
MANIFEST_PATH = os.path.join(MANIFESTS_DIR, "v1.json")

os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(REPORTS_DIR, exist_ok=True)
os.makedirs(MANIFESTS_DIR, exist_ok=True)

# ── Feature & Target columns ───────────────────────────────────────────────
FEATURE_COLS = [
    "team_rank", "team_points", "opponent_rank", "opponent_points",
    "rank_diff", "points_diff", "is_home", "is_host", "is_knockout",
    "same_confed", "host_points_diff",
    "elo_rating_team", "elo_rating_opponent", "elo_diff",
    "team_recent_goals", "opponent_recent_goals",
    "team_recent_conceded", "opponent_recent_conceded",
    "team_recent_form", "opponent_recent_form",
    "tournament_weight",
    "days_since_last_match_team", "days_since_last_match_opponent",
]

TARGET_COLS = ["home_score", "away_score", "result", "total_goals", "both_scored"]
# total_goals_binary = over/under 2.5

MODEL_CONFIG = {
    "xgb_home": {"type": "regressor", "target": "home_score", "file": "xgb_home.pkl"},
    "xgb_away": {"type": "regressor", "target": "away_score", "file": "xgb_away.pkl"},
    "rf_1x2": {"type": "classifier", "target": "result", "file": "rf_1x2.pkl"},
    "xgb_btts": {"type": "classifier", "target": "both_scored", "file": "xgb_btts.pkl"},
    "xgb_over_under": {"type": "classifier", "target": "total_goals_binary", "file": "xgb_over_under.pkl"},
}


def load_and_prepare_data():
    """Load CSV, parse dates, filter valid rows, create binary target."""
    print("=" * 60)
    print("Loading features CSV...")
    df = pd.read_csv(FEATURES_CSV)
    print(f"  Loaded {len(df):,} rows, {len(df.columns)} columns")

    # Parse date
    df["_date"] = pd.to_datetime(df["_date"], errors="coerce")
    df["_year"] = df["_date"].dt.year

    # Drop rows missing any target
    before = len(df)
    df = df.dropna(subset=TARGET_COLS)
    after = len(df)
    print(f"  Dropped {before - after} rows with missing target values ({after:,} remaining)")

    # Create total_goals_binary (over/under 2.5)
    df["total_goals_binary"] = (df["total_goals"] > 2.5).astype(int)

    # Encode result (W/D/L -> 0/1/2)
    label_enc = LabelEncoder()
    df["result_encoded"] = label_enc.fit_transform(df["result"])
    print(f"  Result classes: {dict(zip(label_enc.classes_, label_enc.transform(label_enc.classes_)))}")

    # Ensure feature columns are numeric (coerce errors)
    for col in FEATURE_COLS:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Fill NaN in feature columns with median to handle rows with partial data
    # (e.g. early matches missing elo ratings)
    pre_fill = len(df)
    null_counts = df[FEATURE_COLS].isna().sum()
    cols_with_nulls = null_counts[null_counts > 0]
    if len(cols_with_nulls) > 0:
        print(f"  Feature columns with nulls: {dict(cols_with_nulls)}")
    for col in FEATURE_COLS:
        median_val = df[col].median()
        if pd.isna(median_val):
            median_val = 0
        df[col] = df[col].fillna(median_val)
    print(f"  Filled NaN features in all {pre_fill:,} rows")

    return df, label_enc


def split_time_series(df):
    """Strict time-series split: train <= 2018, val = 2019-2022, test >= 2023."""
    train_mask = df["_year"] <= 2018
    val_mask = (df["_year"] >= 2019) & (df["_year"] <= 2022)
    test_mask = df["_year"] >= 2023

    train = df[train_mask].copy()
    val = df[val_mask].copy()
    test = df[test_mask].copy()

    print(f"\n  Train:  {len(train):,} rows (≤2018)")
    print(f"  Val:    {len(val):,} rows (2019-2022)")
    print(f"  Test:   {len(test):,} rows (≥2023)")

    # Prepare feature matrices
    X_train = train[FEATURE_COLS].values
    X_val = val[FEATURE_COLS].values
    X_test = test[FEATURE_COLS].values

    targets = {}
    for name, cfg in MODEL_CONFIG.items():
        tgt = cfg["target"]
        if tgt == "result":
            targets[name] = {
                "y_train": train["result_encoded"].values,
                "y_val": val["result_encoded"].values,
                "y_test": test["result_encoded"].values,
            }
        elif tgt == "total_goals_binary":
            targets[name] = {
                "y_train": train[tgt].values,
                "y_val": val[tgt].values,
                "y_test": test[tgt].values,
            }
        else:
            targets[name] = {
                "y_train": train[tgt].values,
                "y_val": val[tgt].values,
                "y_test": test[tgt].values,
            }

    return X_train, X_val, X_test, targets, train, val, test


def train_xgb_regressor(X_train, y_train, X_val, y_val, name):
    """Train XGBoost regressor for home/away goals."""
    print(f"\n--- Training {name} (XGBoost Regressor) ---")
    model = xgb.XGBRegressor(
        n_estimators=500,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        eval_metric="rmse",
        early_stopping_rounds=50,
        verbosity=0,
    )
    model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        verbose=False,
    )
    return model


def train_xgb_classifier(X_train, y_train, X_val, y_val, name):
    """Train XGBoost classifier for BTTS / over-under."""
    print(f"\n--- Training {name} (XGBoost Classifier) ---")
    model = xgb.XGBClassifier(
        n_estimators=500,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        eval_metric="logloss",
        early_stopping_rounds=50,
        verbosity=0,
        use_label_encoder=False,
    )
    model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        verbose=False,
    )
    return model


def train_rf_classifier(X_train, y_train, X_val, y_val, name):
    """Train Random Forest classifier for result (1X2)."""
    print(f"\n--- Training {name} (Random Forest Classifier) ---")
    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=12,
        min_samples_split=10,
        min_samples_leaf=5,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)
    return model


def evaluate_regressor(model, X, y, dataset_name):
    """Evaluate regression model."""
    preds = model.predict(X)
    rmse = np.sqrt(mean_squared_error(y, preds))
    mae = mean_absolute_error(y, preds)
    return {
        "dataset": dataset_name,
        "rmse": round(float(rmse), 4),
        "mae": round(float(mae), 4),
        "mean_actual": round(float(np.mean(y)), 4),
        "mean_pred": round(float(np.mean(preds)), 4),
    }


def evaluate_classifier(model, X, y, dataset_name, is_multiclass=False):
    """Evaluate classifier: accuracy, log_loss, brier score (binary only)."""
    preds = model.predict(X)
    acc = accuracy_score(y, preds)

    metrics = {
        "dataset": dataset_name,
        "accuracy": round(float(acc), 4),
        "n_samples": int(len(y)),
    }

    # Log loss / predicted probabilities
    if hasattr(model, "predict_proba"):
        try:
            probs = model.predict_proba(X)
            if is_multiclass:
                ll = log_loss(y, probs)
                metrics["log_loss"] = round(float(ll), 4)
            else:
                ll = log_loss(y, probs)
                metrics["log_loss"] = round(float(ll), 4)
                # Brier score: only for binary (take prob of class 1)
                if probs.shape[1] == 2:
                    bs = brier_score_loss(y, probs[:, 1])
                    metrics["brier_score"] = round(float(bs), 4)
        except Exception:
            pass

    # Confusion matrix
    cm = confusion_matrix(y, preds)
    metrics["confusion_matrix"] = cm.tolist()

    return metrics


def plot_feature_importance(model, feature_names, title, save_path, top_n=20):
    """Plot and save feature importance (gain-based for XGBoost, impurity for RF)."""
    if hasattr(model, "feature_importances_"):
        importances = model.feature_importances_
    elif hasattr(model, "get_booster"):
        # XGBoost: use weight importance by default, but gain is better
        importance_dict = model.get_booster().get_score(importance_type="gain")
        importances = np.zeros(len(feature_names))
        for feat_idx_str, val in importance_dict.items():
            # feat_idx_str is "f0", "f1", ...
            idx = int(feat_idx_str.replace("f", ""))
            if idx < len(importances):
                importances[idx] = val
    else:
        print(f"  [WARN] No feature_importances_ for {title}")
        return

    indices = np.argsort(importances)[::-1][:top_n]
    plt.figure(figsize=(10, 8))
    plt.barh(range(len(indices)), importances[indices][::-1], align="center")
    plt.yticks(range(len(indices)), [feature_names[i] for i in indices[::-1]])
    plt.xlabel("Importance")
    plt.title(title)
    plt.tight_layout()
    plt.savefig(save_path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  Saved importance plot: {save_path}")


def save_model(model, file_name):
    """Save model with joblib."""
    path = os.path.join(MODELS_DIR, file_name)
    joblib.dump(model, path)
    print(f"  Saved model: {path}")
    return path


def build_manifest(models_info, metrics_summary, run_id):
    """Create manifest JSON."""
    manifest = {
        "version": "v1",
        "run_id": run_id,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "feature_count": len(FEATURE_COLS),
        "features": FEATURE_COLS,
        "targets": TARGET_COLS,
        "total_goals_binary_threshold": 2.5,
        "time_split": {
            "train": "<= 2018",
            "val": "2019-2022",
            "test": ">= 2023",
        },
        "models": models_info,
        "metrics": metrics_summary,
    }
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\n  Saved manifest: {MANIFEST_PATH}")


def main():
    print("=" * 60)
    print("FOOTBALL MATCH PREDICTION — TRAINING PIPELINE")
    print("=" * 60)
    run_id = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    # 1. Load & prepare
    df, label_enc = load_and_prepare_data()

    # 2. Split
    X_train, X_val, X_test, targets, train_df, val_df, test_df = split_time_series(df)

    print(f"\nFeature matrix shapes:")
    print(f"  X_train: {X_train.shape}")
    print(f"  X_val:   {X_val.shape}")
    print(f"  X_test:  {X_test.shape}")

    # 3. Train models
    models = {}
    models_info = []

    # ── XGBoost Regressor: home_goals ──
    model = train_xgb_regressor(X_train, targets["xgb_home"]["y_train"],
                                X_val, targets["xgb_home"]["y_val"], "xgb_home")
    save_model(model, "xgb_home.pkl")
    plot_feature_importance(model, FEATURE_COLS,
                            "XGBoost Feature Importance — Home Goals",
                            os.path.join(REPORTS_DIR, "importance_xgb_home.png"))
    models["xgb_home"] = model
    models_info.append({"name": "xgb_home", "type": "XGBRegressor", "target": "home_score", "file": "xgb_home.pkl"})

    # ── XGBoost Regressor: away_goals ──
    model = train_xgb_regressor(X_train, targets["xgb_away"]["y_train"],
                                X_val, targets["xgb_away"]["y_val"], "xgb_away")
    save_model(model, "xgb_away.pkl")
    plot_feature_importance(model, FEATURE_COLS,
                            "XGBoost Feature Importance — Away Goals",
                            os.path.join(REPORTS_DIR, "importance_xgb_away.png"))
    models["xgb_away"] = model
    models_info.append({"name": "xgb_away", "type": "XGBRegressor", "target": "away_score", "file": "xgb_away.pkl"})

    # ── Random Forest Classifier: result (1X2) ──
    model = train_rf_classifier(X_train, targets["rf_1x2"]["y_train"],
                                X_val, targets["rf_1x2"]["y_val"], "rf_1x2")
    save_model(model, "rf_1x2.pkl")
    plot_feature_importance(model, FEATURE_COLS,
                            "Random Forest Feature Importance — Match Result (1X2)",
                            os.path.join(REPORTS_DIR, "importance_rf_1x2.png"))
    models["rf_1x2"] = model
    models_info.append({"name": "rf_1x2", "type": "RandomForestClassifier", "target": "result", "file": "rf_1x2.pkl"})

    # ── XGBoost Classifier: both_scored ──
    model = train_xgb_classifier(X_train, targets["xgb_btts"]["y_train"],
                                 X_val, targets["xgb_btts"]["y_val"], "xgb_btts")
    save_model(model, "xgb_btts.pkl")
    plot_feature_importance(model, FEATURE_COLS,
                            "XGBoost Feature Importance — Both Teams Scored",
                            os.path.join(REPORTS_DIR, "importance_xgb_btts.png"))
    models["xgb_btts"] = model
    models_info.append({"name": "xgb_btts", "type": "XGBClassifier", "target": "both_scored", "file": "xgb_btts.pkl"})

    # ── XGBoost Classifier: total_goals_binary (over/under 2.5) ──
    model = train_xgb_classifier(X_train, targets["xgb_over_under"]["y_train"],
                                 X_val, targets["xgb_over_under"]["y_val"], "xgb_over_under")
    save_model(model, "xgb_over_under.pkl")
    plot_feature_importance(model, FEATURE_COLS,
                            "XGBoost Feature Importance — Over/Under 2.5",
                            os.path.join(REPORTS_DIR, "importance_xgb_over_under.png"))
    models["xgb_over_under"] = model
    models_info.append({"name": "xgb_over_under", "type": "XGBClassifier", "target": "total_goals_binary", "file": "xgb_over_under.pkl"})

    # 4. Evaluate
    print("\n" + "=" * 60)
    print("EVALUATION METRICS")
    print("=" * 60)

    all_metrics = {}

    # Regression metrics
    for name in ["xgb_home", "xgb_away"]:
        print(f"\n▶ {name}:")
        for X, y, ds_name in [(X_train, targets[name]["y_train"], "Train"),
                              (X_val, targets[name]["y_val"], "Val"),
                              (X_test, targets[name]["y_test"], "Test")]:
            m = evaluate_regressor(models[name], X, y, ds_name)
            print(f"  {ds_name:>6} | RMSE: {m['rmse']:.4f} | MAE: {m['mae']:.4f} | "
                  f"μ_actual: {m['mean_actual']:.3f} | μ_pred: {m['mean_pred']:.3f}")
        all_metrics[name] = {
            "train": evaluate_regressor(models[name], X_train, targets[name]["y_train"], "Train"),
            "val": evaluate_regressor(models[name], X_val, targets[name]["y_val"], "Val"),
            "test": evaluate_regressor(models[name], X_test, targets[name]["y_test"], "Test"),
        }

    # Classifier metrics
    for name in ["rf_1x2", "xgb_btts", "xgb_over_under"]:
        is_mc = (name == "rf_1x2")
        print(f"\n▶ {name}:")
        for X, y, ds_name in [(X_train, targets[name]["y_train"], "Train"),
                              (X_val, targets[name]["y_val"], "Val"),
                              (X_test, targets[name]["y_test"], "Test")]:
            m = evaluate_classifier(models[name], X, y, ds_name, is_multiclass=is_mc)
            parts = [f"  {ds_name:>6} | Acc: {m['accuracy']:.4f}"]
            if "log_loss" in m:
                parts.append(f"LogLoss: {m['log_loss']:.4f}")
            if "brier_score" in m:
                parts.append(f"Brier: {m['brier_score']:.4f}")
            print(" | ".join(parts))
        all_metrics[name] = {
            "train": evaluate_classifier(models[name], X_train, targets[name]["y_train"], "Train", is_multiclass=is_mc),
            "val": evaluate_classifier(models[name], X_val, targets[name]["y_val"], "Val", is_multiclass=is_mc),
            "test": evaluate_classifier(models[name], X_test, targets[name]["y_test"], "Test", is_multiclass=is_mc),
        }

    # 5. Save training report
    report = {
        "run_id": run_id,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "data_info": {
            "total_rows": len(df),
            "feature_count": len(FEATURE_COLS),
            "features": FEATURE_COLS,
            "train_rows": len(train_df),
            "val_rows": len(val_df),
            "test_rows": len(test_df),
            "train_years": f"{train_df['_year'].min()}-{train_df['_year'].max()}",
            "val_years": f"{val_df['_year'].min()}-{val_df['_year'].max()}",
            "test_years": f"{test_df['_year'].min()}-{test_df['_year'].max()}",
        },
        "model_config": MODEL_CONFIG,
        "metrics": all_metrics,
    }

    report_path = os.path.join(REPORTS_DIR, f"training_report_{run_id}.json")
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n  Saved training report: {report_path}")

    # Also save a plain-text summary
    summary_path = os.path.join(REPORTS_DIR, "latest_report.txt")
    with open(summary_path, "w") as f:
        f.write("FOOTBALL MATCH PREDICTION — TRAINING REPORT\n")
        f.write(f"Run ID: {run_id}\n")
        f.write(f"Timestamp: {report['timestamp']}\n\n")
        f.write(f"Total rows: {len(df):,}\n")
        f.write(f"Train: {len(train_df):,} rows | Val: {len(val_df):,} rows | Test: {len(test_df):,} rows\n\n")
        f.write("─" * 50 + "\n")
        for name, splits in all_metrics.items():
            f.write(f"\n{name}:\n")
            for split_name, m in splits.items():
                line = f"  {split_name}: "
                for k, v in m.items():
                    if k != "confusion_matrix" and k != "dataset":
                        line += f"{k}={v} "
                f.write(line.strip() + "\n")
    print(f"  Saved text summary: {summary_path}")

    # 6. Build manifest
    summary_metrics = {}
    for name, splits in all_metrics.items():
        summary_metrics[name] = {k: {kk: vv for kk, vv in v.items() if kk != "confusion_matrix"}
                                 for k, v in splits.items()}

    build_manifest(models_info, summary_metrics, run_id)

    print("\n" + "=" * 60)
    print("TRAINING PIPELINE COMPLETE")
    print("=" * 60)
    print(f"  Models saved to: {MODELS_DIR}")
    print(f"  Reports saved to: {REPORTS_DIR}")
    print(f"  Manifest saved to: {MANIFEST_PATH}")


if __name__ == "__main__":
    main()
