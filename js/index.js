const screens = {
    initial: document.getElementById('initial-screen'),
    connecting: document.getElementById('connecting-screen'),
    connected: document.getElementById('connected-screen')
};

const availableImages = document.getElementById('available-images');

const getAvailableImagesButton = document.getElementById("button-get-latest-image");
const buttonLoadImage = document.getElementById("button-load-image");

const deviceName = document.getElementById('device-name');
const bleFilterConnection = document.getElementById('filter-ble-connection');
const connectButton = document.getElementById('button-connect');
const disconnectButton = document.getElementById('button-disconnect');
const resetButton = document.getElementById('button-reset');
const imageStateButton = document.getElementById('button-image-state');
const imageList = document.getElementById('image-list');
const fileInfo = document.getElementById('file-info');
const fileStatus = document.getElementById('file-status');
const fileUpload = document.getElementById('file-upload');
const bluetoothIsAvailable = document.getElementById('bluetooth-is-available');
const bluetoothIsAvailableMessage = document.getElementById('bluetooth-is-available-message');
const connectBlock = document.getElementById('connect-block');

if (navigator && navigator.bluetooth && navigator.bluetooth.getAvailability()) {
    bluetoothIsAvailable.style.display = 'none';
    connectBlock.style.display = 'block';
} else {
    bluetoothIsAvailable.className = 'alert alert-danger';
    bluetoothIsAvailableMessage.innerText = 'Bluetooth is not available in your browser.';
}

// default filtering yay
bleFilterConnection.checked = true;

// indicator for awaiting reconnect after mandatory reset in the auto upload process
let confirmAtNextConnect = false;

let file = null;
let fileData = null;
let images = [];


const mcumgr = new MCUManager();
mcumgr.onConnecting(() => {
    console.log('Connecting...');
    screens.initial.style.display = 'none';
    screens.connected.style.display = 'none';
    screens.connecting.style.display = 'block';
});

buttonLoadImage.addEventListener("click", firmwareVersionSelected);

let lastSelectedFirmware;

function firmwareVersionSelected(){

    // reduce number of calls on the sad proxy
    if(availableImages.value === lastSelectedFirmware){
        return;
    }
    lastSelectedFirmware = availableImages.value;

    const url = "https://api.github.com/repos/Dev-Voltaic/Voltaic_Tacho_Firmware/releases/tags/" + availableImages.value;

    // get the link to the bin file
    fetch(url).then((response) => {
        response.text().then((text) => {
            let responseJSON = JSON.parse(text);

            // go through all assets and get the first one that is a .bin file
            responseJSON.assets.forEach((asset) => {
                if(asset.name.endsWith(".bin")){
                    // FUCK CORS
                    let proxyUrl = 'https://api.codetabs.com/v1/proxy?quest=' + asset.browser_download_url;

                    // download image file via cors proxy
                    fetch(proxyUrl,
                        {
                            method : "GET",
                            headers: {},
                            // follor redirect requests!!!
                            redirect: "follow"
                        }).then((fileResponse) => {

                            // read the image file into the mcumgr
                            fileResponse.blob().then(fileResponseBlob => {
                                updateSelectedFile(fileResponseBlob);
                            });
                    });
                }
            });
        });
    });
}

function getAvailableImages(){
    const url = 'https://api.github.com/repos/Dev-Voltaic/Voltaic_Tacho_Firmware/releases';

    // get all available releases from repo
    fetch(url).then((response) => {
        response.text().then((text) => {
            let responseJSON = JSON.parse(text);

            availableImages.innerHTML = "";

            // programatically fill select
            responseJSON.forEach((release) => {
                const firmwareVersion = release.tag_name;

                let opt = document.createElement("option");
                opt.value = firmwareVersion;
                opt.innerHTML = firmwareVersion; // whatever property it has

                // then append it to the select element
                availableImages.appendChild(opt);
            });
        });
    });
}

mcumgr.onConnect(() => {
    deviceName.innerText = mcumgr.name;
    screens.connecting.style.display = 'none';
    screens.initial.style.display = 'none';
    screens.connected.style.display = 'block';
    imageList.innerHTML = '';
    mcumgr.cmdImageState();

    getAvailableImages();

    // further continuation of auto upload process

    if(confirmAtNextConnect){
        setTimeout(async ()=>{

            fileStatus.innerText = 'Confirming Upload';


            //CONFIRM
            if (images.length > 0 && images[0].confirmed === false) {
                await mcumgr.cmdImageConfirm(images[0].hash);
            }

            fileStatus.innerText = 'Auto update COMPLETE!';

            confirmAtNextConnect = false;
        }, 500);
    }
});

getAvailableImagesButton.addEventListener("click", ()=>{
    // clear old available images
    availableImages.innerHTML = "";

    // get new ones
    getAvailableImages();
});

mcumgr.onDisconnect(() => {
    deviceName.innerText = 'Connect your device';
    screens.connecting.style.display = 'none';
    screens.connected.style.display = 'none';
    screens.initial.style.display = 'block';
});

mcumgr.onMessage(({ op, group, id, data, length }) => {
    switch (group) {
        case MGMT_GROUP_ID_OS:
            switch (id) {
                case OS_MGMT_ID_ECHO:
                    alert(data.r);
                    break;
                case OS_MGMT_ID_TASKSTAT:
                    console.table(data.tasks);
                    break;
                case OS_MGMT_ID_MPSTAT:
                    console.log(data);
                    break;
            }
            break;
        case MGMT_GROUP_ID_IMAGE:
            switch (id) {
                case IMG_MGMT_ID_STATE:
                    images = data.images;
                    let imagesHTML = '';
                    images.forEach(image => {
                        imagesHTML += `<div class="image ${image.active ? 'active' : 'standby'}">`;
                        imagesHTML += `<h2>Slot #${image.slot} ${image.active ? 'active' : 'standby'}</h2>`;
                        imagesHTML += '<table class="table-responsive">';
                        const hashStr = Array.from(image.hash).map(byte => byte.toString(16).padStart(2, '0')).join('');
                        imagesHTML += `<tr><th>Version</th><td>v${image.version}</td></tr>`;
                        imagesHTML += `<tr><th>Bootable</th><td>${image.bootable}</td></tr>`;
                        imagesHTML += `<tr><th>Confirmed</th><td>${image.confirmed}</td></tr>`;
                        imagesHTML += `<tr><th>Pending</th><td>${image.pending}</td></tr>`;
                        imagesHTML += `<tr><th>Hash</th><td>${hashStr}</td></tr>`;
                        imagesHTML += '</table>';
                        imagesHTML += '</div>';
                    });
                    imageList.innerHTML = imagesHTML;

                    break;
            }
            break;
        default:
            console.log('Unknown group');
            break;
    }
});

mcumgr.onImageUploadProgress(({ percentage }) => {
    fileStatus.innerText = `Uploading... ${percentage}%`;
});

mcumgr.onImageUploadFinished(async () => {
    fileStatus.innerText = 'Upload complete';
    fileInfo.innerHTML = '';
    await mcumgr.cmdImageState();

    setTimeout(async()=>{
        // continuation of automated upload process

        //TEST
        fileStatus.innerText = 'Testing Image';
        if (images.length > 1 && images[1].pending === false) {
            await mcumgr.cmdImageTest(images[1].hash);
        }

        //RESET
        fileStatus.innerText = 'Will reset shortly';

        setTimeout(async ()=>{
            confirmAtNextConnect = true;
            await mcumgr.cmdReset();
        }, 1500);
    }, 1500);
});

function updateSelectedFile(file){
    console.log(file);
    fileData = null;
    const reader = new FileReader();
    reader.onload = async () => {
        fileData = reader.result;
        try {
            const info = await mcumgr.imageInfo(fileData);
            let table = `<table class="table-responsive">`
            table += `<tr><th>Version</th><td>v${info.version}</td></tr>`;
            table += `<tr><th>Hash</th><td>${info.hash}</td></tr>`;
            table += `<tr><th>File Size</th><td>${fileData.byteLength} bytes</td></tr>`;
            table += `<tr><th>Size</th><td>${info.imageSize} bytes</td></tr>`;
            table += `</table>`;

            fileStatus.innerText = 'Ready to upload';
            fileInfo.innerHTML = table;
            fileUpload.disabled = false;
        } catch (e) {
            fileInfo.innerHTML = `ERROR: ${e.message}`;
        }
    };
    reader.readAsArrayBuffer(file);
}

connectButton.addEventListener('click', async () => {

    let options = {
        optionalServices: [
            // shared services
            'device_information',

            // BMS Services
            "e9ea0200-e19b-482d-9293-c7907585fc48",
            "e9ea0100-e19b-482d-9293-c7907585fc48",
            "e9ea0400-e19b-482d-9293-c7907585fc48",
            "e9ea0300-e19b-482d-9293-c7907585fc48",
            "e9ea0500-e19b-482d-9293-c7907585fc48",

            // Tacho Services
            "ffd70200-fe1b-4b6d-aba1-36cc0bab3e3d",
            "ffd70100-fe1b-4b6d-aba1-36cc0bab3e3d"
        ]
    };
    if(bleFilterConnection.checked) {
        options.filters = [{
            manufacturerData: [{
                // nice
                companyIdentifier: 0x6969
            }]
        }];
    }else{
        options.acceptAllDevices = true;
    }

    await mcumgr.connect(options);
});

fileUpload.addEventListener('click', async (event) => {

    /*
    Connect
    Erase
    Upload
    Test
    Reset
    Confirm
     */

    // ERASE
    fileStatus.innerText = 'Erasing';
    await mcumgr.cmdImageErase();


    setTimeout(()=>{
        //UPLOAD
        fileUpload.disabled = true;
        event.stopPropagation();
        if (fileData) {
            mcumgr.cmdUpload(fileData);
        }
    },1000);

    // as this is not asynchronous but with a callback function
    // this shit continues in the mcumgr.onImageUploadFinished
});

disconnectButton.addEventListener('click', async () => {
    mcumgr.disconnect();
});

resetButton.addEventListener('click', async () => {
    await mcumgr.cmdReset();
});

imageStateButton.addEventListener('click', async () => {
    await mcumgr.cmdImageState();
});