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
            console.log('🔍 Checking geofence for:', { latitude, longitude });
            
            const { data: geofences, error } = await supabase
                .from('geofence_settings')
                .select('*')
                .eq('is_active', true);

            if (error) throw error;

            console.log('📊 Active geofences found:', geofences?.length || 0);

            if (!geofences || geofences.length === 0) {
                console.log('⚠️ No active geofences found in database');
                return {
                    inside: false,
                    geofence: null,
                    distance: null,
                    error: 'No geofence configured'
                };
            }

            for (const fence of geofences) {
                const distance = this.calculateDistance(
                    latitude, longitude,
                    parseFloat(fence.latitude), 
                    parseFloat(fence.longitude)
                );

                console.log(`📍 Distance to ${fence.location_name}:`, distance.toFixed(2), 'meters');

                if (distance <= fence.radius_meters) {
                    console.log(`✅ Inside geofence: ${fence.location_name}`);
                    return {
                        inside: true,
                        geofence: fence,
                        distance: Math.round(distance * 100) / 100,
                        location_name: fence.location_name,
                        geofence_id: fence.id,
                        radius: fence.radius_meters
                    };
                }
            }

            console.log('❌ Outside all geofences');
            return {
                inside: false,
                geofence: null,
                distance: null,
                nearest: await this.findNearestGeofence(latitude, longitude, geofences)
            };

        } catch (error) {
            console.error('❌ Geofence check error:', error);
            throw error;
        }
    }

    /**
     * Find nearest geofence when outside all
     * @param {number} latitude - Current latitude
     * @param {number} longitude - Current longitude
     * @param {Array} geofences - List of active geofences
     * @returns {Promise<Object>} Nearest geofence info
     */

    static async findNearestGeofence(latitude, longitude, geofences) {
        try {
            let nearest = null;
            let minDistance = Infinity;

            for (const fence of geofences) {
                const distance = this.calculateDistance(
                    latitude, longitude,
                    parseFloat(fence.latitude),
                    parseFloat(fence.longitude)
                );

                if (distance < minDistance) {
                    minDistance = distance;
                    nearest = {
                        location_name: fence.location_name,
                        distance: Math.round(distance * 100) / 100,
                        radius: fence.radius_meters,
                        id: fence.id
                    };
                }
            }

            return nearest;
        } catch (error) {
            console.error('Error finding nearest geofence:', error);
            return null;
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
     * Get geofence by ID
     * @param {number} id - Geofence ID
     * @returns {Promise<Object>} Geofence object
     */

    static async getGeofenceById(id) {
        try {
            const { data: geofence, error } = await supabase
                .from('geofence_settings')
                .select('*')
                .eq('id', id)
                .maybeSingle();

            if (error) throw error;
            return geofence;
        } catch (error) {
            console.error(`❌ Error fetching geofence ${id}:`, error);
            throw error;
        }
    }

    /**
     * Validate if coordinates are within any geofence
     * @param {number} latitude - Latitude to check
     * @param {number} longitude - Longitude to check
     * @returns {Promise<Object>} Validation result
     */

    static async validateLocation(latitude, longitude) {
        try {
            const result = await this.checkGeofence(latitude, longitude);
            
            if (result.inside) {
                return {
                    valid: true,
                    message: `Location within ${result.location_name}`,
                    ...result
                };
            } else {
                return {
                    valid: false,
                    message: result.nearest ? 
                        `Outside all geofences. Nearest: ${result.nearest.location_name} (${result.nearest.distance}m away)` :
                        'No active geofences found',
                    ...result
                };
            }
        } catch (error) {
            console.error('❌ Error validating location:', error);
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
            const { data, error } = await supabase
                .from('geofence_settings')
                .update(updates)
                .eq('id', id)
                .select();

            if (error) throw error;

            if (!data || data.length === 0) {
                throw new Error('Geofence not found');
            }

            console.log(`✅ Geofence ${id} updated`);
            return data[0];
        } catch (error) {
            console.error('❌ Error updating geofence:', error);
            throw error;
        }
    }

    /**
     * Delete geofence (soft delete)
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

            console.log(`✅ Geofence ${id} deactivated`);
            return { success: true, geofence: data[0] };
        } catch (error) {
            console.error('❌ Error deleting geofence:', error);
            throw error;
        }
    }
}

module.exports = GeofenceService;