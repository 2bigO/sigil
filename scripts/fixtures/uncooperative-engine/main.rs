//! Deliberately uncooperative semantic-engine stand-in for timeout tests.

use std::io::{self, Read};
use std::thread;
use std::time::Duration;

fn main() {
    let mut request = Vec::new();
    let _ = io::stdin().read_to_end(&mut request);
    loop {
        thread::sleep(Duration::from_secs(60));
    }
}
