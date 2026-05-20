// import { Marker } from "react-map-gl/mapbox";
// import type { EmployeeLocation } from "@workspace/api-client-react";

// interface EmployeeMarkerProps {
//   employee: EmployeeLocation;
//   isSelected?: boolean;
//   onClick?: () => void;
// }

// export default function EmployeeMarker({
//   employee,
//   isSelected,
//   onClick,
// }: EmployeeMarkerProps) {
//   const initial = employee.employeeName?.charAt(0).toUpperCase() ?? "?";
//   const color = stringToColor(employee.employeeName);

//   return (
//     <Marker
//       latitude={employee.latitude}
//       longitude={employee.longitude}
//       anchor="center"
//       onClick={(e) => {
//         e.originalEvent?.stopPropagation();
//         onClick?.();
//       }}
//     >
//       <div className="relative cursor-pointer">
//         <div
//           className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md transition-transform ${
//             isSelected ? "scale-125 ring-2 ring-white" : ""
//           }`}
//           style={{ backgroundColor: color }}
//         >
//           {initial}
//         </div>
//         <span className="absolute inset-0 rounded-full animate-ping opacity-30" style={{ backgroundColor: color }} />
//       </div>
//     </Marker>
//   );
// }

// function stringToColor(str: string): string {
//   let hash = 0;
//   for (let i = 0; i < str.length; i++) {
//     hash = str.charCodeAt(i) + ((hash << 5) - hash);
//   }
//   const c = (hash & 0x00ffffff).toString(16).padStart(6, "0");
//   return `#${c}`;
// }

// EmployeeMarker is now rendered directly inside LiveMap.tsx via Google Maps
// AdvancedMarkerElement. This file is kept as a no-op export for compatibility.
export default function EmployeeMarker() { return null; }