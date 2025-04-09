import { useEffect, useRef, useState } from 'react'; 
import axios from 'axios';
import AxiosMockAdapter from 'axios-mock-adapter';

const IMAGE_SIZE =  2 * 1024 * 1024 * 1024;

// mock server
const getStatusUrl = new RegExp("/status/[1-9]d*");
const getCancelUrl = new RegExp("/cancel/[1-9]d*");
const mock = new AxiosMockAdapter(axios);
let ongoingTasks = {};

mock.onGet(getStatusUrl).reply((config) => {
  const taskId = config?.url?.split("/")?.pop();
  let returnStatus = 200;

  if (!ongoingTasks[taskId]) {
    return [400, { msg: "Task not found" }]
  }

  // check if cancelled
  if (ongoingTasks[taskId].isCancelled) {
    ongoingTasks[taskId].status = "cancelled";
    returnStatus = 200;
  }

  ongoingTasks[taskId].checks++;
  let isSuccess = Math.random() > 0.1; // 10% of failure
  if (!isSuccess) { // return error status on failure
   ongoingTasks[taskId].status = "failed";
   returnStatus = 500;
  }

  if (ongoingTasks[taskId].checks >= 3) {
    ongoingTasks[taskId].status = "done";
  }

  return [returnStatus, { status: ongoingTasks[taskId].status }];
})

mock.onGet("/get-task").reply(() => {
  var taskId = Math.floor(Math.random() * (9999 - 1) + 1); // returns a random task id between  1 - 9999
  return [200, { task_id: taskId }]
});

mock.onPost("/upload").reply((config) => {
  let taskId = config?.headers?.task_id
  ongoingTasks[taskId] = { status: "pending", checks: 0, isCancelled: false };
  return ([200, {}]);
});

mock.onPost(getCancelUrl).reply((config) => {
  const taskId = config?.url?.split("/")?.pop();
  ongoingTasks[taskId].isCancelled = true;
  return [200, {}]
});

const FileUploader = () => {
  const [uploadList, setUploadList] = useState({});
  const [currentFile, setCurrentFile] = useState(null);
  var uploadFile = useRef(null);

  const getTaskId = async () => await axios.get("/get-task");

  const handleAddFile = async (e) => {
    const { files } = e.target;
    const file = files?.[0] ?? null;
    if (!file) return;

    const isValidImage = ['image/jpeg', 'image/png' ] && file?.size <= IMAGE_SIZE;

    if (!isValidImage) {
      e.target.value = null;
      console.log("image too big");
      return
    }

    let isIdAvailable = false;
    while (!isIdAvailable) {
      let res = await getTaskId();
      let taskId = res?.data?.task_id;

      if (!uploadList[taskId]) { // check to see if taskId is taken
        setUploadList((prev) => ({ ...prev, [taskId]: { file: file, uploadStatus: "awaiting upload" } })); // add file to upload list
        setCurrentFile(taskId);
        isIdAvailable = true;
      }
    }
  }

  const taskStatusChange = (taskId, status) => {
    let updateEntry = uploadList[taskId];
    updateEntry.uploadStatus = status;
    setUploadList((prev) => ({ ...prev, [taskId]: updateEntry })); 
  }

  const pollTask = async (taskId, taskStatusChange) => {
    let tries = 0;

    const interval = setInterval(async () => {
      console.log(`checking task ${taskId} progress...`);

      try {
        tries++;
        const res = await axios.get(`/status/${taskId}`);
        const status = res?.data?.status;

        if (status === "done") {
          clearInterval(interval);
          taskStatusChange(taskId, `upload complete`);
          console.log(`${taskId} upload complete!`);
        }

        if (status === "cancelled") {
          clearInterval(interval);
          console.log(`${taskId} upload cancelled.`);
        }

        if (tries > 3) {
          clearInterval(interval);
          taskStatusChange(taskId, "upload error");
          console.log("file upload timed out.")
        }
      } catch(err) {
        clearInterval(interval);
        taskStatusChange(taskId, "upload error");
        console.log(`upload task ${taskId} failed: ${err}`);
      }
    }, 2500);
  }

  const cancelUpload = (taskId) => {
    // remove from list
    setUploadList((prev) => {
      var updatedList = { ...prev };
      delete updatedList[taskId];
      return updatedList;
    });
    axios.post(`/cancel/${taskId}`);
  }

  const uploadOneFile = (taskId, file) => {
    if (!file) return;

    var formData = new FormData();
    formData.append("file", file)
    axios.post("/upload", formData, {
      headers: { "task_id": taskId },
    });
    console.log(`uploading file: ${file?.name} task_id: ${taskId}`);

    let updateEntry = uploadList[taskId];
    updateEntry.uploadStatus = "pending";

    setUploadList((prev) => ({ ...prev, [taskId]: updateEntry }));

    return pollTask(taskId, taskStatusChange);
  };

  useEffect(() => {
    return () => {
      if (currentFile) {
        cancelUpload(currentFile);
      }
    }
  }, []); // eslint-disable-line

  const showRetryStatuses = ["upload error", "upload cancelled"]; // statuses on when to show retry button
  const showUploadStatuses = ["awaiting upload", ...showRetryStatuses]; // file statuses when to show upload/retry button
  
  return (
    <div>
      <input ref={uploadFile} type="file" onChange={handleAddFile} accept='.jpeg, .png, .pdf' />
      {showUploadStatuses.includes(uploadList[currentFile]?.uploadStatus) && (
        <button type="button" onClick={() => uploadOneFile(currentFile, uploadList[currentFile]?.file)}>
          {showRetryStatuses.includes(uploadList[currentFile]?.uploadStatus) ? "Retry" : "Upload"}
        </button>
      )}
      {(uploadList[currentFile]?.uploadStatus === "pending") && (
        <button type="button" onClick={() => cancelUpload(currentFile)}>Cancel</button>
      )}
      <div className='upload-list'>
        {Object.entries(uploadList).map(([id, entry]) => (
          <div key={id}>
            <div>Name: {entry.file.name}</div>
            <div>Status: {entry.uploadStatus}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default FileUploader;
