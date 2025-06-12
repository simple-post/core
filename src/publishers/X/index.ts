import { Content } from "../../types/post";
import { Publisher } from "../../types/publisher";

export class XPublisher implements Publisher {
  post(content: Content) {
    console.log(content);
  }
}
