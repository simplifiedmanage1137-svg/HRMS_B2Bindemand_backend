const axios = require('axios');

// Test the documents endpoint fix
async function testDocumentsEndpoint() {
    try {
        console.log('🧪 Testing GET /api/employees/:employeeId/documents endpoint...\n');
        
        // Test with a valid employee ID
        const testEmployeeId = 'B2B250702'; // From the error log
        const url = `http://localhost:5000/api/employees/${testEmployeeId}/documents`;
        
        console.log(`📍 Testing URL: ${url}\n`);
        
        const response = await axios.get(url);
        
        console.log('✅ SUCCESS! Status:', response.status);
        console.log('📊 Response data:', response.data);
        console.log('\n✅ Endpoint is working correctly - no 500 error!');
        
        return true;
    } catch (error) {
        if (error.response) {
            console.log('❌ ERROR Status:', error.response.status);
            console.log('📋 Error response:', error.response.data);
            
            if (error.response.status === 404) {
                console.log('\n✅ Good - This is a 404 (employee not found), not a 500!');
                console.log('The endpoint error handling is working correctly.');
                return true;
            } else if (error.response.status === 500) {
                console.log('\n❌ Still getting 500 error - fix did not work');
                return false;
            }
        } else {
            console.log('❌ Connection error:', error.message);
        }
        return false;
    }
}

testDocumentsEndpoint().then(success => {
    process.exit(success ? 0 : 1);
});
