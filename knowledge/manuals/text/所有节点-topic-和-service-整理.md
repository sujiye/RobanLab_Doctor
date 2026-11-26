# 所有节点 topic 和 service 整理

- 源文件：`knowledge/manuals/pdf/所有节点 topic 和 service 整理.pdf`
- 页数：3 · 图片对象：0
- 转换工具：`tools/extract_manuals.py`（PyMuPDF 1.28.0）
- 页码标记：下文每页以 `<!-- page N -->` 开头，引用时写「《文档名》 p.N」。
- 图片页（文本层 <160 字符）：已渲染为 `knowledge/manuals/figures/` 下的 PNG 并以图片链接嵌入。

---
<!-- page 1 -->

# 所有节点 topic 和 service 整理

## /chin_camera

### Publications

1. /chin_camera/image [sensor_msgs/Image]

发布下巴摄像头的视频流

## /ros_color_node

### Services

1. /chinCamera_color_recognition [ros_color_node/ColorRecognition]

下巴摄像头颜色识别

2. /color_recognition [ros_color_node/ColorRecognition]

眼睛摄像头颜色识别

## /ros_face_node

### Services

1. /ros_face_node/face_detect

人脸识别

## /ros_gesture_node

### Services

1. /ros_gesture_node/gesture_detect

手势识别

## /ros_label_node

### Publications

1. /camera/label/image_raw [sensor_msgs/Image]

眼睛摄像头中画一个矩形框

2. /chin_camera/label/image_raw [sensor_msgs/Image]

下巴摄像头画一个矩形框

## /ros_mic_arrays

<!-- page 2 -->

### Publications

1. /micarrays/wakeup [std_msgs/String]

麦克风阵列唤醒

## /ros_msg_node

### Services

1. /ros_msg_node/process_msg_process

进度通知

2. /ros_msg_node/finish_msg_process

结束通知

## /ros_socket_node

### Publications

1. /Finish [std_msgs/String]

结束

2. /MediumSize/BodyHub/HeadPosition [bodyhub/JointControlPoint]

控制头部舵机

3. /MediumSize/BodyHub/MotoPosition [bodyhub/JointControlPoint]

控制所有关节

4. /MediumSize/BodyHub/jointControl [sensor_msgs/JointState]

控制关节，可以指定任意关节

5. /VirtualPanel [std_msgs/String]

虚拟手柄

6. /gaitCommand [std_msgs/Float64MultiArray]

步态控制

7. /terminate_current_process [std_msgs/String]

终止当前的示例进程

8. /ActRunner/DeviceList [ros_actions_node/DeviceList]

发送摄像头和控制器的状态

### Subscriptions

<!-- page 3 -->

1. /MediumSize/BodyHub/Status [std_msgs/UInt16]

状态机状态

2. /MediumSize/BodyHub/WalkingStatus [std_msgs/Float64]

机器人的步行状态

3. /requestGaitCommand [std_msgs/Bool]

行走模式下，机器人中脚步指令低于一定值时，请求新的控制脚步。
