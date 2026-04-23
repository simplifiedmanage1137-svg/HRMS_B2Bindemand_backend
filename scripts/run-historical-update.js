const { updateHistoricalLateMarks } = require('./update-historical-late-marks');

console.log('🚀 Starting Historical Late Marks Update...');
console.log('='.repeat(70));

updateHistoricalLateMarks()
    .then(result => {
        console.log('\n📈 UPDATE COMPLETED!');
        console.log('='.repeat(70));
        
        if (result.success) {
            console.log('✅ Status: SUCCESS');
            console.log(`📊 Total Records: ${result.totalRecords}`);
            console.log(`✅ Updated: ${result.updatedCount}`);
            console.log(`✓ Already Correct: ${result.alreadyCorrectCount}`);
            console.log(`❌ Errors: ${result.errorCount}`);
            
            if (result.updatedCount > 0) {
                console.log('\n🎉 Historical late marks have been successfully updated!');
                console.log('All employees who clocked in late will now show their late marks.');
            } else {
                console.log('\n✓ All records were already up to date.');
            }
        } else {
            console.log('❌ Status: FAILED');
            console.log(`Error: ${result.error}`);
        }
        
        console.log('='.repeat(70));
        process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
        console.error('\n❌ FATAL ERROR:');
        console.error(error);
        console.log('='.repeat(70));
        process.exit(1);
    });