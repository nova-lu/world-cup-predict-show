import os
import streamlit as st
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder

# Configure page settings
st.set_page_config(
    page_title="FIFA World Cup Predictor",
    page_icon="⚽",
    layout="centered"
)

# Custom styling for a clean look
st.markdown("""
<style>
    .main {
        background-color: #0f1116;
        color: #e2e8f0;
    }
    .stApp {
        background: radial-gradient(circle at top right, #1e1115, #08090d);
    }
    h1, h2, h3 {
        color: #f59e0b !important; /* Gold header */
        font-family: 'Inter', sans-serif;
    }
    .card {
        background-color: #1a1416;
        padding: 20px;
        border-radius: 12px;
        border: 1px solid #451a22;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        margin-bottom: 20px;
    }
    .metric-value {
        font-size: 2.2rem;
        font-weight: bold;
        color: #f59e0b;
    }
</style>
""", unsafe_allow_html=True)

st.title("🏆 FIFA World Cup Predictor (In Progress)")
st.caption("This is a live prototype of our FIFA World Cup Predictor. It trains a Random Forest model on historical international match results from results.csv.")

# Load Dataset (cached for performance)
@st.cache_data
def load_and_preprocess_data():
    if not os.path.exists("results.csv"):
        st.error("⚠️ results.csv not found! Please make sure it is in the directory.")
        st.stop()
        
    matches = pd.read_csv("results.csv")
    
    # Keep only World Cup & Qualifiers
    matches = matches[matches["tournament"].isin(["FIFA World Cup", "FIFA World Cup qualification"])].copy()
    
    # Create Result Column (W = Home Win, L = Away Win, D = Draw)
    matches["result"] = matches.apply(
        lambda row: "W" if row["home_score"] > row["away_score"]
        else ("L" if row["home_score"] < row["away_score"] else "D"),
        axis=1
    )
    
    # Generate unique list of teams
    all_teams = sorted(list(set(matches["home_team"].tolist() + matches["away_team"].tolist())))
    
    return matches, all_teams

matches, all_teams = load_and_preprocess_data()

# Encode Teams
team_encoder = LabelEncoder()
team_encoder.fit(all_teams)
matches["home_code"] = team_encoder.transform(matches["home_team"])
matches["away_code"] = team_encoder.transform(matches["away_team"])

# Map Results to targets: L = 0, D = 1, W = 2
result_map = {"L": 0, "D": 1, "W": 2}
matches["target"] = matches["result"].map(result_map)

# Train Random Forest Classifier
@st.cache_resource
def train_fifa_model(X, y):
    model = RandomForestClassifier(n_estimators=200, random_state=42)
    model.fit(X, y)
    return model

X = matches[["home_code", "away_code"]]
y = matches["target"]
model = train_fifa_model(X, y)

# Sidebar roadmap info
with st.sidebar:
    st.markdown("### 🛠️ Project Roadmap")
    st.markdown("""
    **Phase 1: Basic Head-to-Head** (Active)
    * Random Forest classifier trained on historical match pairs.
    
    **Phase 2: Elo Rating System** (Planned)
    * Calculate dynamic Elo ratings for all countries over time.
    
    **Phase 3: Monte Carlo Engine** (Planned)
    * Simulate the entire group stage and knockout bracket 10,000 times.
    """)
    st.info("Created by: Aryan")

# User selection UI
st.subheader("Select Teams for Fixture")
col1, col2 = st.columns(2)
with col1:
    team1 = st.selectbox("Select Home Team:", all_teams, index=all_teams.index("Argentina") if "Argentina" in all_teams else 0)
with col2:
    team2 = st.selectbox("Select Away Team:", all_teams, index=all_teams.index("France") if "France" in all_teams else 1)

if st.button("🔮 Predict Match Outcome", use_container_width=True):
    if team1 == team2:
        st.warning("⚠️ Please select two different teams.")
    else:
        # Encode inputs
        home_code = team_encoder.transform([team1])[0]
        away_code = team_encoder.transform([team2])[0]
        
        # Predict outcome and probabilities
        prediction = model.predict([[home_code, away_code]])[0]
        probabilities = model.predict_proba([[home_code, away_code]])[0]
        
        st.subheader("📊 Model Output")
        
        # Display Verdict
        if prediction == 2:
            st.success(f"🏆 **Model Prediction**: **{team1}** is predicted to WIN at home.")
        elif prediction == 0:
            st.success(f"🏆 **Model Prediction**: **{team2}** is predicted to WIN away.")
        else:
            st.info(f"🤝 **Model Prediction**: Match is likely to end in a **DRAW**.")
            
        # Display Probabilities
        st.subheader("📈 Match Probabilities")
        p_cols = st.columns(3)
        with p_cols[0]:
            st.metric(f"{team1} Win", f"{probabilities[2]*100:.1f}%")
        with p_cols[1]:
            st.metric("Draw", f"{probabilities[1]*100:.1f}%")
        with p_cols[2]:
            st.metric(f"{team2} Win", f"{probabilities[0]*100:.1f}%")
