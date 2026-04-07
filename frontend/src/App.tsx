import { Routes, Route } from "react-router-dom";
import { MapView } from "./components/Map/MapView";
import { MapList } from "./components/Layout/MapList";
import { Header } from "./components/Layout/Header";
import { PublicMapView } from "./components/Map/PublicMapView";
import { PublicIndex } from "./components/Layout/PublicIndex";
import { NotFound } from "./components/Layout/NotFound";

export default function App() {
  return (
    <Routes>
      <Route path="/public/:token" element={<PublicMapView />} />
      <Route path="/welcome" element={<PublicIndex />} />
      <Route
        path="*"
        element={
          <div className="min-h-screen bg-noc-bg text-noc-text flex flex-col">
            <Header />
            <main className="flex-1">
              <Routes>
                <Route path="/" element={<MapList />} />
                <Route path="/map/:mapId" element={<MapView />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </main>
          </div>
        }
      />
    </Routes>
  );
}
