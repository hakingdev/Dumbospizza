"use client";

import { useEffect, useState } from 'react';
import { Save, Plus, MapPin, Trash2, Edit, Loader2 } from 'lucide-react';

type DeliveryZone = {
  _id: string;
  name: string;
  minOrderAmount: number;
  deliveryFee: number;
  maxDistance: number;
  active: boolean;
  sortOrder: number;
};

export default function DeliveryZonesPage() {
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingZone, setEditingZone] = useState<null | {
    _id?: string;
    name: string;
    minOrderAmount: number;
    deliveryFee: number;
    maxDistance: number;
    active: boolean;
    sortOrder: number;
  }>(null);

  useEffect(() => {
    const loadZones = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/delivery-zones?all=1');
        const data = await response.json();
        if (data.success) {
          setZones(data.zones || []);
        } else {
          setError(data.error || 'Failed to load delivery zones');
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load delivery zones');
      } finally {
        setLoading(false);
      }
    };

    loadZones();
  }, []);

  const handleEdit = (zone: DeliveryZone | null) => {
    if (zone) {
      setEditingZone({
        _id: zone._id,
        name: zone.name,
        minOrderAmount: zone.minOrderAmount,
        deliveryFee: zone.deliveryFee,
        maxDistance: zone.maxDistance,
        active: zone.active,
        sortOrder: zone.sortOrder
      });
    } else {
      setEditingZone({
        name: '',
        minOrderAmount: 10,
        deliveryFee: 0,
        maxDistance: 5,
        active: true,
        sortOrder: 0
      });
    }
  };

  const handleSave = async () => {
    if (!editingZone) return;

    try {
      setSaving(true);
      setError(null);
      if (editingZone._id) {
        const response = await fetch(`/api/delivery-zones/${editingZone._id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingZone)
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to update zone');
        setZones(zones.map((zone) => (zone._id === editingZone._id ? data.zone : zone)));
      } else {
        const response = await fetch('/api/delivery-zones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingZone)
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to create zone');
        setZones([...zones, data.zone]);
      }
      setEditingZone(null);
    } catch (err: any) {
      setError(err.message || 'Failed to save zone');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (zoneId: string) => {
    try {
      setSaving(true);
      setError(null);
      const response = await fetch(`/api/delivery-zones/${zoneId}`, { method: 'DELETE' });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to delete zone');
      setZones(zones.filter(zone => zone._id !== zoneId));
    } catch (err: any) {
      setError(err.message || 'Failed to delete zone');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (zoneId: string) => {
    const current = zones.find((zone) => zone._id === zoneId);
    if (!current) return;
    try {
      setSaving(true);
      setError(null);
      const response = await fetch(`/api/delivery-zones/${zoneId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...current, active: !current.active })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to update zone');
      setZones(zones.map(zone => (zone._id === zoneId ? data.zone : zone)));
    } catch (err: any) {
      setError(err.message || 'Failed to update zone');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">Delivery Zones</h1>
        <button
          onClick={() => handleEdit(null)}
          className="bg-primary-600 text-white px-4 py-2 rounded-md flex items-center hover:bg-primary-700 transition-colors"
        >
          <Plus className="w-5 h-5 mr-2" />
          Add New Zone
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 bg-gray-50 border-b border-gray-100">
          <div className="grid grid-cols-12 font-medium text-gray-500">
            <div className="col-span-3">Name</div>
            <div className="col-span-2">Minimum Order</div>
            <div className="col-span-2">Delivery Fee</div>
            <div className="col-span-2">Max Distance</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-500">
            <Loader2 className="h-5 w-5 inline-block animate-spin mr-2" />
            Loading zones...
          </div>
        ) : zones.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No delivery zones configured yet. Add your first zone.
          </div>
        ) : (
          <div>
            {zones.map(zone => (
              <div key={zone._id} className="p-4 border-b border-gray-100 hover:bg-gray-50">
                <div className="grid grid-cols-12 items-center">
                  <div className="col-span-3 flex items-center">
                    <MapPin className="h-5 w-5 mr-2 text-gray-400" />
                    <span className="font-medium">{zone.name}</span>
                  </div>
                  <div className="col-span-2">
                    {zone.minOrderAmount.toFixed(2)} €
                  </div>
                  <div className="col-span-2">
                    {zone.deliveryFee.toFixed(2)} €
                  </div>
                  <div className="col-span-2">
                    {zone.maxDistance} km
                  </div>
                  <div className="col-span-1">
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      zone.active
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {zone.active ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                  <div className="col-span-2 flex justify-end space-x-2">
                    <button
                      onClick={() => handleEdit(zone)}
                      className="p-1 rounded hover:bg-gray-100 text-gray-600 hover:text-primary-600"
                      title="Edit zone"
                    >
                      <Edit className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => toggleActive(zone._id)}
                      className={`p-1 rounded hover:bg-gray-100 ${
                        zone.active
                          ? 'text-green-600 hover:text-green-800'
                          : 'text-red-600 hover:text-red-800'
                      }`}
                      title={zone.active ? 'Disable zone' : 'Activate zone'}
                    >
                      <span className="sr-only">{zone.active ? 'Disable' : 'Activate'}</span>
                      {zone.active ? 'Disable' : 'Activate'}
                    </button>
                    <button
                      onClick={() => handleDelete(zone._id)}
                      className="p-1 rounded hover:bg-gray-100 text-gray-600 hover:text-red-600"
                      title="Delete zone"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editingZone && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">
              {!editingZone._id ? 'Add New Zone' : 'Edit Zone'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Zone Name</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={editingZone.name}
                  onChange={(e) => setEditingZone({ ...editingZone, name: e.target.value })}
                  placeholder="e.g., Downtown"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Minimum Order Amount (€)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={editingZone.minOrderAmount}
                  onChange={(e) => setEditingZone({ ...editingZone, minOrderAmount: parseFloat(e.target.value) || 0 })}
                  min="0"
                  step="0.5"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Fee (€)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={editingZone.deliveryFee}
                  onChange={(e) => setEditingZone({ ...editingZone, deliveryFee: parseFloat(e.target.value) || 0 })}
                  min="0"
                  step="0.5"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Distance (km)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={editingZone.maxDistance}
                  onChange={(e) => setEditingZone({ ...editingZone, maxDistance: parseFloat(e.target.value) || 0 })}
                  min="0"
                  step="0.5"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={editingZone.sortOrder}
                  onChange={(e) => setEditingZone({ ...editingZone, sortOrder: parseInt(e.target.value, 10) || 0 })}
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="zone-active"
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  checked={editingZone.active}
                  onChange={(e) => setEditingZone({ ...editingZone, active: e.target.checked })}
                />
                <label htmlFor="zone-active" className="ml-2 block text-sm text-gray-700">
                  Zone is active
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => setEditingZone(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 flex items-center"
                disabled={!editingZone.name || saving}
              >
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
