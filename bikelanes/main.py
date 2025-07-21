import streamlit as st
import geopandas as gpd
import folium
from shapely.ops import unary_union
from streamlit_folium import st_folium
import re
import warnings

warnings.filterwarnings("ignore")

@st.cache_data
def load_data():
    bike_routes = gpd.read_file("bike_routes.geojson").to_crs(epsg=4326)
    collisions = gpd.read_file("collisions.geojson").to_crs(epsg=4326)
    return bike_routes, collisions

bike_routes, collisions = load_data()

def extract_year_columns(columns):
    years = set()
    for col in columns:
        match = re.search(r"20\d{2}", col)
        if match:
            years.add(match.group())
    return sorted(years)

def point_in_area(point, area):
    return point.within(area) if point and area else False


def filter_collisions(data, threshold, year_range):
    data = data[data[collision_column] >= threshold]

    def in_range(row):
        return any(
            isinstance(row[col], (int, float)) and row[col] > 0
            for col in row.index
            for year in range(year_range[0], year_range[1] + 1)
            if str(year) in col
        )

    return data[data.apply(in_range, axis=1)]

def get_combined_area(gdf, label="Suggested Route", buffer_m=5):
    filtered = gdf[gdf["EXISTING_CYCLING_NETWORK"] == label]
    filtered_utm = filtered.to_crs(epsg=32618)
    buffered_utm = filtered_utm.buffer(buffer_m)
    combined = unary_union(buffered_utm)
    return gpd.GeoSeries([combined], crs="EPSG:32618").to_crs(epsg=4326).iloc[0]


year_cols = extract_year_columns(collisions.columns)
min_year, max_year = min(map(int, year_cols)), max(map(int, year_cols))

st.title("🚲 Suggested Isn't Safe")
st.subheader("Where Ottawa Cyclists Crash and Why \u201cSuggested Routes\u201d Aren't Enough")

year_range = st.slider("Filter by Year Range", min_year, max_year, (min_year, max_year))

collision_column = "Total_Cyclists_Collisions"
if collision_column not in collisions.columns:
    st.error(f"Missing '{collision_column}' column in your data.")
    st.stop()

min_collisions = max(1, int(collisions[collision_column].min()))
max_collisions = int(collisions[collision_column].max())
collision_threshold = st.slider("Minimum Cyclist Collisions", min_collisions, max_collisions, 1)
bike_crashes = filter_collisions(collisions, collision_threshold, year_range)
combined_area = get_combined_area(bike_routes)
bike_crashes["in_suggested_route"] = bike_crashes.geometry.apply(lambda pt: point_in_area(pt, combined_area))
st.markdown(f"Showing crashes from **{year_range[0]}** to **{year_range[1]}** with at least **{collision_threshold}** cyclist collisions.")
in_network = bike_crashes[bike_crashes["in_suggested_route"]]
off_network = bike_crashes[~bike_crashes["in_suggested_route"]]

st.markdown("### 📊 Summary")
col1, col2, col3 = st.columns(3)
col1.metric("Total Crashes", len(bike_crashes))
col2.metric("On Suggested Routes", len(in_network))
col3.metric("Off Suggested Routes", len(off_network))


m = folium.Map(location=[45.42, -75.69], zoom_start=12, control_scale=True)

folium.GeoJson(
    bike_routes[bike_routes["EXISTING_CYCLING_NETWORK"] == "Suggested Route"],
    name="Suggested Cycling Routes",
    style_function=lambda x: {"color": "blue", "weight": 3},
    tooltip=folium.GeoJsonTooltip(fields=["EXISTING_CYCLING_NETWORK"], aliases=["Route Type:"])
).add_to(m)

for _, row in in_network.iterrows():
    folium.CircleMarker(
        location=[row.geometry.y, row.geometry.x],
        radius=5, color="orange", fill=True, fill_color="orange", fill_opacity=0.7,
        popup=f"Cyclist Crashes: {row.get(collision_column, 'N/A')}"
    ).add_to(m)

for _, row in off_network.iterrows():
    folium.CircleMarker(
        location=[row.geometry.y, row.geometry.x],
        radius=5, color="red", fill=True, fill_color="red", fill_opacity=0.7,
        popup=f"Cyclist Crashes: {row.get(collision_column, 'N/A')}"
    ).add_to(m)

st.markdown("Interactive Map")
st_folium(m, width=900, height=600)
