#![cfg(target_os = "macos")]
#![deny(clippy::all)]
// objc2-foundation marks some of these calls unsafe in one release and safe in another.
#![allow(unused_unsafe)]

use napi::bindgen_prelude::*;
use napi::Task;
use napi_derive::napi;
use objc2::rc::autoreleasepool;
use objc2_foundation::{NSFileManager, NSString, NSURL};

/// Whether the user is signed in to iCloud with iCloud Drive on. Cheap; safe on the main thread.
#[napi]
pub fn identity_available() -> bool {
    autoreleasepool(|_| {
        let manager = NSFileManager::defaultManager();
        unsafe { manager.ubiquityIdentityToken() }.is_some()
    })
}

pub struct ContainerPath {
    identifier: String,
}

impl Task for ContainerPath {
    type Output = Option<String>;
    type JsValue = Option<String>;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(autoreleasepool(|_| {
            let manager = NSFileManager::defaultManager();
            let identifier = NSString::from_str(&self.identifier);
            let url = unsafe { manager.URLForUbiquityContainerIdentifier(Some(&identifier)) }?;
            unsafe { url.path() }.map(|path| path.to_string())
        }))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// The local folder of an iCloud container, or null when this app may not use it (no iCloud
/// entitlement, signed out, iCloud Drive off). The first call also sets the container up, and it
/// can block for a while, so it runs off the main thread as Apple asks.
#[napi(ts_return_type = "Promise<string | null>")]
pub fn container_path(identifier: String) -> AsyncTask<ContainerPath> {
    AsyncTask::new(ContainerPath { identifier })
}

/// Asks iCloud to download a file it keeps only in the cloud. Returns at once; the file arrives
/// later and the folder watcher sees it.
#[napi]
pub fn start_downloading(path: String) -> Result<()> {
    autoreleasepool(|_| {
        let manager = NSFileManager::defaultManager();
        let url = unsafe { NSURL::fileURLWithPath(&NSString::from_str(&path)) };
        unsafe { manager.startDownloadingUbiquitousItemAtURL_error(&url) }
            .map_err(|error| Error::from_reason(error.localizedDescription().to_string()))
    })
}
