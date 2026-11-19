// The three.js add-ons in vendor/three-addons are ES modules that import
// "three". This module hands them the copy of three.js the page already
// loaded (vendor/three.min.js), so three.js is only downloaded once.
const T = window.THREE;
export const {
  AnimationClip, Bone, Box3, BufferAttribute, BufferGeometry, ClampToEdgeWrapping, Color, ColorManagement, DirectionalLight, DoubleSide, FileLoader, Float32BufferAttribute, FrontSide, Group, ImageBitmapLoader, InstancedBufferAttribute, InstancedMesh, InterleavedBuffer, InterleavedBufferAttribute, Interpolant, InterpolateDiscrete, InterpolateLinear, Line, LineBasicMaterial, LineLoop, LineSegments, LinearFilter, LinearMipmapLinearFilter, LinearMipmapNearestFilter, LinearSRGBColorSpace, Loader, LoaderUtils, Material, MathUtils, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, MirroredRepeatWrapping, NearestFilter, NearestMipmapLinearFilter, NearestMipmapNearestFilter, NumberKeyframeTrack, Object3D, OrthographicCamera, PerspectiveCamera, PointLight, Points, PointsMaterial, PropertyBinding, Quaternion, QuaternionKeyframeTrack, RepeatWrapping, SRGBColorSpace, Skeleton, SkinnedMesh, Sphere, SpotLight, Texture, TextureLoader, TriangleFanDrawMode, TriangleStripDrawMode, TrianglesDrawMode, Vector2, Vector3, VectorKeyframeTrack,
} = T;
