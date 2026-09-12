"""Central knobs. Everything price/agronomy-tunable lives here so nothing is a
magic number buried in logic. All thresholds are DEFENSIBLE DEFAULTS you can
cite/adjust — none are load-bearing secrets."""

# --- economics (all AUD; parameterise before the pitch, prices are volatile) ---
UREA_PRICE_PER_T = 800.0          # AUD/t  [assumption — verify on the day]
UREA_N_FRACTION = 0.46            # urea is 46% N
# fraction of applied N lost EXTRA when applied into a bad-timing window vs a good one
BAD_TIMING_LOSS_LOW = 0.20        # [assumption, from volatilisation/leaching ranges]
BAD_TIMING_LOSS_HIGH = 0.40

# --- agronomic thresholds (deterministic derived signals) ---
INCORP_RAIN_MIN_MM = 5.0          # rain that moves surface urea into soil
INCORP_RAIN_MAX_MM = 15.0         # above this on light soils -> leaching territory
LEACHING_RAIN_MM_72H = 25.0       # >this within 72h of application = leaching risk
LEACHING_SOILS = {"sand", "loamy_sand", "sandy_loam", "duplex"}  # light/duplex
VOLAT_TMAX_C = 22.0               # warm enough to drive ammonia loss if no incorp
SATURATION_VWC = 0.42            # vol. water content above which soil ~ saturated
                                  # (soil-specific in reality; single default here)
FORECAST_HORIZON_DAYS = 7
PAST_WINDOW_DAYS = 14

# --- herbicide (stretch scenario) ---
DELTA_T_MIN = 2.0
DELTA_T_MAX = 8.0
WIND_MIN_KMH = 3.0
WIND_MAX_KMH = 15.0

# --- decision gating ---
CONFIDENCE_GO_MIN = 0.55          # below this the system won't issue GO
RATE_DEVIATION_ALLOWED = 0.30     # +-30% of plan rate without forcing INSPECT

# --- demo location (Wimmera, Vic) ---
DEMO_LAT = -36.72
DEMO_LON = 142.20
DEMO_TZ = "Australia/Melbourne"
