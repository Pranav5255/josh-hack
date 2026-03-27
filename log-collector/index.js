const { spawn, exec } = require('child_process');

const services = ['user-service', 'order-service', 'payment-service', 'gateway-service'];

function getContainerStats(serviceName) {
    return new Promise((resolve) => {
        exec(`docker inspect --format="{{.State.Status}}||{{.State.ExitCode}}" ${serviceName}`, (err, stdout) => {
            if (err) {
                resolve({ status: 'unknown', exitCode: null });
                return;
            }
            const parts = stdout.trim().split('||');
            resolve({
                status: parts[0] || 'unknown',
                exitCode: parseInt(parts[1], 10) || 0
            });
        });
    });
}

function processDataChunk(serviceName, data) {
    const lines = data.toString().split('\n').filter(l => l.trim() !== '');
    if (lines.length === 0) return;
    
    getContainerStats(serviceName).then(stats => {
        const output = {
            service: serviceName,
            timestamp: new Date().toISOString(),
            container_status: stats.status,
            exit_code: stats.exitCode,
            logs: lines
        };
        console.log(JSON.stringify(output, null, 2));
    });
}

const serviceStates = {};

function tailLogs(serviceName) {
    getContainerStats(serviceName).then(stats => {
        if (stats.status === 'running') {
            if (serviceStates[serviceName] !== 'running') {
                console.log(JSON.stringify({
                    service: serviceName,
                    timestamp: new Date().toISOString(),
                    container_status: stats.status,
                    exit_code: stats.exitCode,
                    logs: [`Starting log collection for ${serviceName}...`]
                }, null, 2));
                serviceStates[serviceName] = 'running';
            }

            const dockerArgs = ['logs', '-f', '--tail', '0', serviceName];
            let child = spawn('docker', dockerArgs);

            child.stdout.on('data', (data) => processDataChunk(serviceName, data));
            child.stderr.on('data', (data) => processDataChunk(serviceName, data));

            child.on('close', (code) => {
                getContainerStats(serviceName).then(closeStats => {
                    serviceStates[serviceName] = closeStats.status;
                    console.log(JSON.stringify({
                        service: serviceName,
                        timestamp: new Date().toISOString(),
                        container_status: closeStats.status,
                        exit_code: closeStats.exitCode,
                        logs: [`Log tailing for ${serviceName} exited. Container is now ${closeStats.status}.`]
                    }, null, 2));
                    setTimeout(() => tailLogs(serviceName), 5000);
                });
            });
        } else {
            if (serviceStates[serviceName] !== stats.status) {
                console.log(JSON.stringify({
                    service: serviceName,
                    timestamp: new Date().toISOString(),
                    container_status: stats.status,
                    exit_code: stats.exitCode,
                    logs: [`Container ${serviceName} is ${stats.status}. Waiting to restart log collection...`]
                }, null, 2));
                serviceStates[serviceName] = stats.status;
            }
            setTimeout(() => tailLogs(serviceName), 5000);
        }
    });
}

services.forEach(tailLogs);

setInterval(() => {}, 1000 * 60 * 60);
