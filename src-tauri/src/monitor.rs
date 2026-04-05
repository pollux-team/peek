use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;
use sysinfo::{Networks, System};

pub struct Monitor {
    sys: System,
    last_time: Instant,
    networks: Networks,
    gpu_usage: Arc<Mutex<f32>>,
}

#[derive(Debug, Clone)]
pub struct Stats {
    pub cpu: f32,
    pub gpu: f32,
    pub ram_used: u64,
    pub ram_total: u64,
    pub net_rx: u64,
    pub net_tx: u64,
    pub rx_bytes_delta: u64, // Exact downloaded bytes since last poll
    pub tx_bytes_delta: u64, // Exact uploaded bytes since last poll
}

impl Monitor {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu_usage();
        sys.refresh_memory();

        let mut networks = Networks::new_with_refreshed_list();
        networks.refresh(false);

        let gpu_usage = Arc::new(Mutex::new(0.0));
        let gpu_usage_clone = gpu_usage.clone();

        #[cfg(target_os = "windows")]
        thread::spawn(move || {
            use serde::Deserialize;
            use wmi::{COMLibrary, WMIConnection};

            #[derive(Deserialize, Debug)]
            #[serde(rename_all = "PascalCase")]
            struct GpuAdapter {
                utilization_percentage: Option<u32>,
            }

            if let Ok(com) = COMLibrary::new() {
                if let Ok(con) = WMIConnection::new(com.into()) {
                    loop {
                        if let Ok(adapters) = con.raw_query::<GpuAdapter>("SELECT UtilizationPercentage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapter") {
                            let mut max_usage = 0;
                            for adapter in adapters {
                                if let Some(pct) = adapter.utilization_percentage {
                                    if pct > max_usage { max_usage = pct; }
                                }
                            }
                            if let Ok(mut lock) = gpu_usage_clone.lock() {
                                *lock = max_usage as f32;
                            }
                        }
                        thread::sleep(std::time::Duration::from_secs(1));
                    }
                }
            }
        });

        Self {
            sys,
            last_time: Instant::now(),
            networks,
            gpu_usage,
        }
    }

    pub fn poll(&mut self) -> Stats {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();

        let elapsed = self.last_time.elapsed().as_secs_f64();
        let elapsed = if elapsed <= 0.0 { 1.0 } else { elapsed };
        self.last_time = Instant::now();

        self.networks.refresh(false);

        let rx_delta = self
            .networks
            .iter()
            .map(|(_, net)| net.received())
            .sum::<u64>();
        let tx_delta = self
            .networks
            .iter()
            .map(|(_, net)| net.transmitted())
            .sum::<u64>();

        let rx_speed = ((rx_delta as f64) / elapsed) as u64;
        let tx_speed = ((tx_delta as f64) / elapsed) as u64;

        let cpu = if !self.sys.cpus().is_empty() {
            let sum: f32 = self.sys.cpus().iter().map(|c| c.cpu_usage()).sum();
            sum / (self.sys.cpus().len() as f32)
        } else {
            0.0
        };

        let gpu = *self
            .gpu_usage
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        Stats {
            cpu,
            gpu,
            ram_used: self.sys.used_memory(),
            ram_total: self.sys.total_memory(),
            net_rx: rx_speed,
            net_tx: tx_speed,
            rx_bytes_delta: rx_delta,
            tx_bytes_delta: tx_delta,
        }
    }
}
