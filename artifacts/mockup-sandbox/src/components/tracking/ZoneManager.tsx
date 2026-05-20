import { useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import {
  useListZones,
  useCreateZone,
  useDeleteZone,
} from "@workspace/api-client-react";
import type { Zone } from "@workspace/api-client-react";
import { toast } from "sonner";

interface ZoneManagerProps {
  open: boolean;
  onClose: () => void;
}

export default function ZoneManager({ open, onClose }: ZoneManagerProps) {
  const { data: zones, refetch } = useListZones();
  const createZone = useCreateZone();
  const deleteZone = useDeleteZone();

  const [name, setName] = useState("");
  const [type, setType] = useState<"circle" | "polygon">("circle");
  const [color, setColor] = useState("#3b82f6");
  const [centerLat, setCenterLat] = useState("");
  const [centerLng, setCenterLng] = useState("");
  const [radius, setRadius] = useState("");
  const [polygon, setPolygon] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createZone.mutateAsync({
        data: {
          name,
          type,
          color,
          centerLatitude: type === "circle" ? Number(centerLat) : undefined,
          centerLongitude: type === "circle" ? Number(centerLng) : undefined,
          radiusMeters: type === "circle" ? Number(radius) : undefined,
          polygonGeoJson: type === "polygon" ? polygon : undefined,
        },
      });
      toast.success("Zone created");
      setName("");
      setCenterLat("");
      setCenterLng("");
      setRadius("");
      setPolygon("");
      refetch();
    } catch {
      toast.error("Failed to create zone");
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteZone.mutateAsync({ id });
      toast.success("Zone deleted");
      refetch();
    } catch {
      toast.error("Failed to delete zone");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-xl shadow-lg w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Zone Manager</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4">
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Zone name"
                className="col-span-2 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                required
              />
              <select
                value={type}
                onChange={(e) => setType(e.target.value as "circle" | "polygon")}
                className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="circle">Circle</option>
                <option value="polygon">Polygon</option>
              </select>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-full bg-background border border-border rounded-lg"
              />
            </div>

            {type === "circle" ? (
              <div className="grid grid-cols-3 gap-3">
                <input
                  type="number"
                  step="any"
                  value={centerLat}
                  onChange={(e) => setCenterLat(e.target.value)}
                  placeholder="Lat"
                  className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                />
                <input
                  type="number"
                  step="any"
                  value={centerLng}
                  onChange={(e) => setCenterLng(e.target.value)}
                  placeholder="Lng"
                  className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                />
                <input
                  type="number"
                  step="any"
                  value={radius}
                  onChange={(e) => setRadius(e.target.value)}
                  placeholder="Radius (m)"
                  className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                />
              </div>
            ) : (
              <textarea
                value={polygon}
                onChange={(e) => setPolygon(e.target.value)}
                placeholder='{"type":"Polygon","coordinates":[[[lng,lat],...]]}'
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                rows={4}
                required
              />
            )}

            <button
              type="submit"
              disabled={createZone.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Create Zone
            </button>
          </form>

          <div className="border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Existing Zones</p>
            <div className="space-y-2">
              {zones?.length === 0 && (
                <p className="text-sm text-muted-foreground">No zones yet</p>
              )}
              {zones?.map((zone: Zone) => (
                <div
                  key={zone.id}
                  className="flex items-center gap-3 px-3 py-2 bg-background border border-border rounded-lg"
                >
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: zone.color || "#3b82f6" }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{zone.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{zone.type}</p>
                  </div>
                  <button
                    onClick={() => handleDelete(zone.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
