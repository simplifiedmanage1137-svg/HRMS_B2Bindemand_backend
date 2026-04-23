const supabase = require('../config/supabase');

/**
 * Check if IP is whitelisted (office IP)
 * @param {string} ip - IP address to check
 * @returns {Promise<boolean>} - True if IP is whitelisted
 */

const isOfficeIP = async (ip) => {
    try {
        if (!ip) {
            console.log('⚠️ No IP address provided');
            return false;
        }

        // Remove IPv6 prefix if present (::ffff:)
        const cleanIP = ip.replace('::ffff:', '').trim();
        
        console.log(`🔍 Checking IP: ${cleanIP}`);

        // Query Supabase for whitelisted IP
        const { data: whitelisted, error } = await supabase
            .from('ip_whitelist')
            .select('id, ip_address, location, is_active')
            .eq('ip_address', cleanIP)
            .eq('is_active', true)
            .maybeSingle();

        if (error) {
            console.error('❌ Database error checking IP:', error);
            return false;
        }

        if (whitelisted) {
            console.log(`✅ IP ${cleanIP} is whitelisted (${whitelisted.location || 'Office'})`);
            return true;
        }

        console.log(`❌ IP ${cleanIP} is not whitelisted`);
        return false;

    } catch (error) {
        console.error('❌ IP check error:', error);
        return false;
    }
};

/**
 * Get all whitelisted IPs (admin function)
 * @returns {Promise<Array>} - List of whitelisted IPs
 */

const getAllWhitelistedIPs = async () => {
    try {
        const { data: ips, error } = await supabase
            .from('ip_whitelist')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        return {
            success: true,
            ips: ips || []
        };
    } catch (error) {
        console.error('❌ Error fetching whitelisted IPs:', error);
        return {
            success: false,
            message: 'Failed to fetch whitelisted IPs',
            error: error.message
        };
    }
};

/**
 * Add IP to whitelist (admin function)
 * @param {string} ip - IP address to whitelist
 * @param {string} location - Location description
 * @returns {Promise<Object>} - Result object
 */

const addToWhitelist = async (ip, location = 'Office') => {
    try {
        const cleanIP = ip.replace('::ffff:', '').trim();

        // Check if already exists
        const { data: existing, error: checkError } = await supabase
            .from('ip_whitelist')
            .select('id')
            .eq('ip_address', cleanIP)
            .maybeSingle();

        if (checkError) throw checkError;

        if (existing) {
            // Reactivate if exists but inactive
            const { error: updateError } = await supabase
                .from('ip_whitelist')
                .update({
                    is_active: true,
                    location: location
                })
                .eq('id', existing.id);

            if (updateError) throw updateError;

            return {
                success: true,
                message: `IP ${cleanIP} reactivated in whitelist`,
                ip: cleanIP,
                location
            };
        }

        // Add new IP
        const { error: insertError } = await supabase
            .from('ip_whitelist')
            .insert([{
                ip_address: cleanIP,
                location: location,
                is_active: true,
                created_at: new Date().toISOString()
            }]);

        if (insertError) throw insertError;

        return {
            success: true,
            message: `IP ${cleanIP} added to whitelist`,
            ip: cleanIP,
            location
        };

    } catch (error) {
        console.error('❌ Error adding IP to whitelist:', error);
        return {
            success: false,
            message: 'Failed to add IP to whitelist',
            error: error.message
        };
    }
};

/**
 * Remove IP from whitelist (soft delete by setting inactive)
 * @param {string} ip - IP address to remove
 * @returns {Promise<Object>} - Result object
 */

const removeFromWhitelist = async (ip) => {
    try {
        const cleanIP = ip.replace('::ffff:', '').trim();

        const { data: existing, error: checkError } = await supabase
            .from('ip_whitelist')
            .select('id')
            .eq('ip_address', cleanIP)
            .maybeSingle();

        if (checkError) throw checkError;

        if (!existing) {
            return {
                success: false,
                message: `IP ${cleanIP} not found in whitelist`
            };
        }

        // Soft delete by setting inactive
        const { error: updateError } = await supabase
            .from('ip_whitelist')
            .update({ is_active: false })
            .eq('id', existing.id);

        if (updateError) throw updateError;

        return {
            success: true,
            message: `IP ${cleanIP} removed from whitelist`,
            ip: cleanIP
        };

    } catch (error) {
        console.error('❌ Error removing IP from whitelist:', error);
        return {
            success: false,
            message: 'Failed to remove IP from whitelist',
            error: error.message
        };
    }
};

/**
 * Middleware to check attendance eligibility based on IP
 * Attaches client IP and attendance eligibility to request object
 */

const checkAttendanceEligibility = async (req, res, next) => {
    try {
        // Get client IP from various possible headers
        const clientIP = req.headers['x-forwarded-for'] || 
                        req.headers['x-real-ip'] ||
                        req.socket.remoteAddress || 
                        req.connection.remoteAddress ||
                        req.ip;
        
        if (!clientIP) {
            console.log('⚠️ Could not determine client IP');
            req.clientIP = 'unknown';
            req.canMarkAttendance = false;
            req.ipCheckError = 'Could not determine client IP';
            return next();
        }

        // Clean the IP address
        const cleanIP = clientIP.replace('::ffff:', '').trim();
        
        // Check if from office IP
        const isOffice = await isOfficeIP(cleanIP);
        
        // Attach to request for later use
        req.clientIP = cleanIP;
        req.canMarkAttendance = isOffice;
        req.isOfficeIP = isOffice;
        
        // Log for debugging
        if (isOffice) {
            console.log(`✅ ${cleanIP} - Office IP detected, attendance allowed`);
        } else {
            console.log(`⚠️ ${cleanIP} - Non-office IP detected, attendance restricted`);
        }
        
        next();
    } catch (error) {
        console.error('❌ Attendance eligibility middleware error:', error);
        // Don't block the request, just set defaults
        req.clientIP = 'error';
        req.canMarkAttendance = false;
        req.ipCheckError = error.message;
        next();
    }
};

/**
 * Strict middleware - blocks requests from non-office IPs
 */

const requireOfficeIP = async (req, res, next) => {
    try {
        const clientIP = req.headers['x-forwarded-for'] || 
                        req.socket.remoteAddress || 
                        req.connection.remoteAddress;
        
        const cleanIP = clientIP?.replace('::ffff:', '').trim();
        
        if (!cleanIP) {
            return res.status(400).json({
                success: false,
                message: 'Could not determine client IP'
            });
        }

        const isOffice = await isOfficeIP(cleanIP);
        
        if (!isOffice) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. This feature is only available from office network.',
                ip: cleanIP
            });
        }

        req.clientIP = cleanIP;
        req.isOfficeIP = true;
        next();

    } catch (error) {
        console.error('❌ Require office IP middleware error:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking IP whitelist',
            error: error.message
        });
    }
};

module.exports = {
    isOfficeIP,
    checkAttendanceEligibility,
    requireOfficeIP,
    getAllWhitelistedIPs,
    addToWhitelist,
    removeFromWhitelist
};