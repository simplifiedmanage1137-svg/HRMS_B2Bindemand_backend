const axios = require('axios');

const testLateMarks = async () => {
    try {
        console.log('🧪 TESTING LATE MARKS FUNCTIONALITY');
        console.log('='.repeat(50));

        const baseURL = 'http://localhost:5000';
        const employeeId = 'B2B240801';

        console.log(`📋 Testing employee: ${employeeId}`);
        console.log(`🌐 API Base URL: ${baseURL}`);

        // Test 1: Get today's attendance
        console.log('\n📋 TEST 1: Getting today\'s attendance...');
        try {
            const response = await axios.get(`${baseURL}/api/attendance/today/${employeeId}`);
            
            if (response.data.success && response.data.attendance) {
                const att = response.data.attendance;
                console.log('✅ API Response received');
                console.log(`📊 Late Minutes: ${att.late_minutes}`);
                console.log(`📊 Late Display: "${att.late_display}"`);
                console.log(`📊 Is Late: ${att.is_late}`);
                console.log(`🕐 Clock In: ${att.clock_in}`);
                console.log(`📋 Status: ${att.status}`);
                
                if (att.late_minutes > 0) {
                    console.log('✅ Employee is marked as late');
                    if (att.late_display) {
                        console.log(`✅ Late display format: "${att.late_display}"`);
                    } else {
                        console.log('⚠️ Late display is missing');
                    }
                } else {
                    console.log('ℹ️ Employee is not marked as late');
                }
            } else {
                console.log('❌ No attendance data found');
            }
        } catch (error) {
            console.log('❌ API call failed:', error.message);
        }

        // Test 2: Get attendance report
        console.log('\n📋 TEST 2: Getting attendance report...');
        try {
            const today = new Date().toISOString().split('T')[0];
            const response = await axios.get(`${baseURL}/api/attendance/report?start=${today}&end=${today}&employee_id=${employeeId}`);
            
            if (response.data.success && response.data.attendance && response.data.attendance.length > 0) {
                const att = response.data.attendance[0];
                console.log('✅ Attendance report received');
                console.log(`📊 Late Minutes: ${att.late_minutes}`);
                console.log(`📊 Late Display: "${att.late_display}"`);
                console.log(`📊 Is Late: ${att.is_late}`);
                
                if (att.late_minutes > 0) {
                    console.log('✅ Late mark appears in attendance report');
                } else {
                    console.log('ℹ️ No late mark in attendance report');
                }
            } else {
                console.log('❌ No attendance report data found');
            }
        } catch (error) {
            console.log('❌ Attendance report API call failed:', error.message);
        }

        // Test 3: Run historical update
        console.log('\n📋 TEST 3: Running historical update...');
        try {
            const response = await axios.post(`${baseURL}/api/attendance/update-historical-late-marks`);
            
            if (response.data.success) {
                console.log('✅ Historical update completed');
                console.log(`📊 Total Records: ${response.data.totalRecords}`);
                console.log(`📊 Updated: ${response.data.updatedCount}`);
                console.log(`📊 Already Correct: ${response.data.alreadyCorrectCount}`);
                console.log(`📊 Errors: ${response.data.errorCount}`);
            } else {
                console.log('❌ Historical update failed:', response.data.message);
            }
        } catch (error) {
            console.log('❌ Historical update API call failed:', error.message);
        }

        // Test 4: Re-check today's attendance after update
        console.log('\n📋 TEST 4: Re-checking today\'s attendance after update...');
        try {
            const response = await axios.get(`${baseURL}/api/attendance/today/${employeeId}`);
            
            if (response.data.success && response.data.attendance) {
                const att = response.data.attendance;
                console.log('✅ API Response received (after update)');
                console.log(`📊 Late Minutes: ${att.late_minutes}`);
                console.log(`📊 Late Display: "${att.late_display}"`);
                console.log(`📊 Is Late: ${att.is_late}`);
                
                if (att.late_minutes > 0 && att.late_display) {
                    console.log('🎉 SUCCESS: Late marks are working correctly!');
                } else if (att.late_minutes > 0 && !att.late_display) {
                    console.log('⚠️ PARTIAL: Late minutes detected but display format missing');
                } else {
                    console.log('ℹ️ Employee is on time or no late mark needed');
                }
            }
        } catch (error) {
            console.log('❌ Final check API call failed:', error.message);
        }

        console.log('\n='.repeat(50));
        console.log('🏁 TESTING COMPLETED');
        console.log('='.repeat(50));

    } catch (error) {
        console.error('❌ Test error:', error);
    }
};

// Run the test
testLateMarks();