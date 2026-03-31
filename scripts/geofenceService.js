const supabase = require('../config/supabase');

class GeofenceService {
    
    /**
     * Calculate distance between two coordinates using Haversine formula
     * @param {number} lat1 - First latitude
     * @param {number} lon1 - First longitude
     * @param {number} lat2 - Second latitude
     * @param {number} lon2 - Second longitude
     * @returns {number} Distance in meters
     */
    static calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // Earth's radius in meters
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c; // Distance in meters
    }

    /**
     * Check if coordinates are within any active geofence
     * @param {number} latitude - Employee's latitude
     * @param {number} longitude - Employee's longitude
     * @returns {Promise<Object>} Geofence check result
     */
    static async checkGeofence(latitude, longitude) {
        try {
            const { data: geofences, error } = await supabase
                .from('geofence_settings')
                .select('*')
                .eq('is_active', true);

            if (error) throw error;

            for (const fence of geofences || []) {
                const distance = this.calculateDistance(
                    latitude, longitude,
                    parseFloat(fence.latitude), 
                    parseFloat(fence.longitude)
                );

                if (distance <= fence.radius_meters) {
                    return {
                        inside: true,
                        geofence: fence,
                        distance: Math.round(distance * 100) / 100,
                        location_name: fence.location_name,
                        geofence_id: fence.id
                    };
                }
            }

            return {
                inside: false,
                geofence: null,
                distance: null,
                location_name: null,
                geofence_id: null
            };
        } catch (error) {
            console.error('❌ Geofence check error:', error);
            throw error;
        }
    }

    /**
     * Get all active geofences
     * @returns {Promise<Array>} List of active geofences
     */
    static async getActiveGeofences() {
        try {
            const { data: geofences, error } = await supabase
                .from('geofence_settings')
                .select('*')
                .eq('is_active', true)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return geofences || [];
        } catch (error) {
            console.error('❌ Error fetching geofences:', error);
            throw error;
        }
    }

    /**
     * Get all geofences (including inactive) - Admin only
     * @returns {Promise<Array>} List of all geofences
     */
    static async getAllGeofences() {
        try {
            const { data: geofences, error } = await supabase
                .from('geofence_settings')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            return geofences || [];
        } catch (error) {
            console.error('❌ Error fetching all geofences:', error);
            throw error;
        }
    }

    /**
     * Add new geofence (admin only)
     * @param {string} location_name - Name of the location
     * @param {number} latitude - Latitude
     * @param {number} longitude - Longitude
     * @param {number} radius_meters - Radius in meters
     * @returns {Promise<Object>} Created geofence
     */
    static async addGeofence(location_name, latitude, longitude, radius_meters) {
        try {
            // Validate inputs
            if (!location_name || !latitude || !longitude || !radius_meters) {
                throw new Error('All fields are required');
            }

            if (radius_meters < 10 || radius_meters > 1000) {
                throw new Error('Radius must be between 10 and 1000 meters');
            }

            const { data, error } = await supabase
                .from('geofence_settings')
                .insert([{
                    location_name,
                    latitude: parseFloat(latitude),
                    longitude: parseFloat(longitude),
                    radius_meters: parseInt(radius_meters),
                    is_active: true,
                    created_at: new Date().toISOString()
                }])
                .select();

            if (error) throw error;

            console.log(`✅ Geofence added: ${location_name} (${radius_meters}m radius)`);
            return data[0];
        } catch (error) {
            console.error('❌ Error adding geofence:', error);
            throw error;
        }
    }

    /**
     * Update geofence (admin only)
     * @param {number} id - Geofence ID
     * @param {Object} updates - Fields to update
     * @returns {Promise<Object>} Updated geofence
     */
    static async updateGeofence(id, updates) {
        try {
            // Remove fields that shouldn't be updated
            delete updates.id;
            delete updates.created_at;

            const { data, error } = await supabase
                .from('geofence_settings')
                .update(updates)
                .eq('id', id)
                .select();

            if (error) throw error;

            if (!data || data.length === 0) {
                throw new Error('Geofence not found');
            }

            console.log(`✅ Geofence ${id} updated successfully`);
            return data[0];
        } catch (error) {
            console.error('❌ Error updating geofence:', error);
            throw error;
        }
    }

    /**
     * Delete geofence (soft delete by setting inactive)
     * @param {number} id - Geofence ID
     * @returns {Promise<Object>} Result
     */
    static async deleteGeofence(id) {
        try {
            const { data, error } = await supabase
                .from('geofence_settings')
                .update({ is_active: false })
                .eq('id', id)
                .select();

            if (error) throw error;

            if (!data || data.length === 0) {
                throw new Error('Geofence not found');
            }

            console.log(`✅ Geofence ${id} deactivated successfully`);
            return { success: true, message: 'Geofence deactivated', geofence: data[0] };
        } catch (error) {
            console.error('❌ Error deleting geofence:', error);
            throw error;
        }
    }

    /**
     * Hard delete geofence (admin only - use with caution)
     * @param {number} id - Geofence ID
     * @returns {Promise<Object>} Result
     */
    static async hardDeleteGeofence(id) {
        try {
            const { data, error } = await supabase
                .from('geofence_settings')
                .delete()
                .eq('id', id)
                .select();

            if (error) throw error;

            if (!data || data.length === 0) {
                throw new Error('Geofence not found');
            }

            console.log(`✅ Geofence ${id} permanently deleted`);
            return { success: true, message: 'Geofence permanently deleted', geofence: data[0] };
        } catch (error) {
            console.error('❌ Error hard deleting geofence:', error);
            throw error;
        }
    }

    /**
     * Get geofence by ID
     * @param {number} id - Geofence ID
     * @returns {Promise<Object>} Geofence
     */
    static async getGeofenceById(id) {
        try {
            const { data, error } = await supabase
                .from('geofence_settings')
                .select('*')
                .eq('id', id)
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                throw new Error('Geofence not found');
            }

            return data;
        } catch (error) {
            console.error('❌ Error fetching geofence:', error);
            throw error;
        }
    }

    /**
     * Validate if coordinates are within any geofence
     * @param {number} latitude - Latitude to check
     * @param {number} longitude - Longitude to check
     * @returns {Promise<Object>} Validation result with nearest geofence info
     */
    static async validateLocation(latitude, longitude) {
        try {
            const { data: geofences, error } = await supabase
                .from('geofence_settings')
                .select('*')
                .eq('is_active', true);

            if (error) throw error;

            let nearest = null;
            let minDistance = Infinity;

            for (const fence of geofences || []) {
                const distance = this.calculateDistance(
                    latitude, longitude,
                    parseFloat(fence.latitude),
                    parseFloat(fence.longitude)
                );

                if (distance < minDistance) {
                    minDistance = distance;
                    nearest = fence;
                }

                if (distance <= fence.radius_meters) {
                    return {
                        valid: true,
                        within: true,
                        geofence: fence,
                        distance: Math.round(distance * 100) / 100,
                        message: `Location within ${fence.location_name}`
                    };
                }
            }

            return {
                valid: false,
                within: false,
                nearest: nearest ? {
                    location_name: nearest.location_name,
                    distance: Math.round(minDistance * 100) / 100,
                    radius: nearest.radius_meters
                } : null,
                message: nearest ? 
                    `Outside all geofences. Nearest: ${nearest.location_name} (${Math.round(minDistance)}m away)` :
                    'No active geofences found'
            };
        } catch (error) {
            console.error('❌ Error validating location:', error);
            throw error;
        }
    }
}

module.exports = GeofenceService;